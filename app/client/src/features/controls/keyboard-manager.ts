/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import { watchEffect } from 'vue';
import { commandRegistry } from '@/lib/command-registry';
import { keyBindingStore } from './key-binding-store';
import { comboFromEvent, isEditableElement } from './keyboard-utils';
import {
  JOG_ACTIONS,
  DIAGONAL_JOG_ACTIONS,
  performJogStep,
  performDiagonalJogStep,
  startContinuousJogSession,
  startContinuousDiagonalJogSession,
  type ContinuousJogSession
} from './actions';

const JOG_LONG_PRESS_DELAY_MS = 300;
const ACTION_LONG_PRESS_DELAY_MS = 1000;

interface ActiveJogState {
  axis?: 'X' | 'Y' | 'Z';
  direction?: 1 | -1;
  xDir?: 1 | -1;
  yDir?: 1 | -1;
  // For diagonal jogs: track the original keys so we can transition back to single-axis
  xEventCode?: string;
  xCombo?: string;
  yEventCode?: string;
  yCombo?: string;
  combo: string;
  timerId: number | null;
  longPressTriggered: boolean;
  longPressActive: boolean;
  cancelled: boolean;
  session: ContinuousJogSession | null;
  promise: Promise<ContinuousJogSession | null> | null;
  handledShortStep: boolean;
  finished: boolean;
}

interface ActiveLongPressState {
  actionId: string;
  combo: string;
  timerId: number | null;
  completed: boolean;
  cancelled: boolean;
}

class KeyboardManager {
  private enabled = false;
  private jogStates = new Map<string, ActiveJogState>();
  private activeDiagonalKey: string | null = null;
  private longPressStates = new Map<string, ActiveLongPressState>();
  private heldKeys = new Set<string>();

  private handleKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || keyBindingStore.isCaptureMode() || keyBindingStore.isControlsTabActive()) {
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    if (isEditableElement(event.target)) {
      return;
    }

    const combo = comboFromEvent(event);
    if (!combo) {
      return;
    }

    const actionId = keyBindingStore.getBinding(combo);
    if (!actionId) {
      return;
    }

    const action = commandRegistry.getAction(actionId);
    if (!action) {
      return;
    }

    if (action.isEnabled && !action.isEnabled()) {
      return;
    }

    const jogMeta = JOG_ACTIONS[actionId];
    const diagonalJogMeta = DIAGONAL_JOG_ACTIONS[actionId];
    const eventCode = event.code || combo;

    if (jogMeta || diagonalJogMeta) {
      if (this.jogStates.has(eventCode)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (this.activeDiagonalKey && jogMeta && (jogMeta.axis === 'X' || jogMeta.axis === 'Y')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      this.heldKeys.add(eventCode);

      const isDiagonal = this.checkAndHandleDiagonalJog(eventCode, jogMeta, combo);
      if (isDiagonal) {
        return;
      }

      const state: ActiveJogState = jogMeta
        ? {
            axis: jogMeta.axis,
            direction: jogMeta.direction,
            combo,
            timerId: null,
            longPressTriggered: false,
            longPressActive: false,
            cancelled: false,
            session: null,
            promise: null,
            handledShortStep: false,
            finished: false
          }
        : {
            xDir: diagonalJogMeta.xDir,
            yDir: diagonalJogMeta.yDir,
            combo,
            timerId: null,
            longPressTriggered: false,
            longPressActive: false,
            cancelled: false,
            session: null,
            promise: null,
            handledShortStep: false,
            finished: false
          };

      this.jogStates.set(eventCode, state);

      state.timerId = window.setTimeout(() => {
        this.beginLongPress(eventCode, state);
      }, JOG_LONG_PRESS_DELAY_MS);
      return;
    }

    if (action.requiresLongPress) {
      const eventCode = event.code || combo;

      if (this.longPressStates.has(eventCode)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const longPressState: ActiveLongPressState = {
        actionId,
        combo,
        timerId: null,
        completed: false,
        cancelled: false
      };

      this.longPressStates.set(eventCode, longPressState);

      longPressState.timerId = window.setTimeout(() => {
        this.executeLongPressAction(eventCode, longPressState);
      }, ACTION_LONG_PRESS_DELAY_MS);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commandRegistry.execute(actionId);
  };

  private checkAndHandleDiagonalJog(eventCode: string, jogMeta: { axis: 'X' | 'Y' | 'Z', direction: 1 | -1 } | undefined, combo: string): boolean {
    if (!jogMeta || jogMeta.axis === 'Z') {
      return false;
    }

    let xAction: { eventCode: string, direction: 1 | -1, combo: string, state?: ActiveJogState } | null = null;
    let yAction: { eventCode: string, direction: 1 | -1, combo: string, state?: ActiveJogState } | null = null;

    for (const [stateEventCode, state] of this.jogStates.entries()) {
      if (state.finished) {
        continue;
      }
      if (state.axis === 'X') {
        xAction = { eventCode: stateEventCode, direction: state.direction!, combo: state.combo, state };
      } else if (state.axis === 'Y') {
        yAction = { eventCode: stateEventCode, direction: state.direction!, combo: state.combo, state };
      }
    }

    if (jogMeta.axis === 'X') {
      xAction = { eventCode, direction: jogMeta.direction, combo };
    } else if (jogMeta.axis === 'Y') {
      yAction = { eventCode, direction: jogMeta.direction, combo };
    }

    if (xAction && yAction) {
      const diagonalKey = `diagonal-${xAction.direction}-${yAction.direction}`;

      if (this.jogStates.has(diagonalKey)) {
        return true;
      }

      const diagonalActionId = Object.keys(DIAGONAL_JOG_ACTIONS).find(id => {
        const meta = DIAGONAL_JOG_ACTIONS[id];
        return meta.xDir === xAction!.direction && meta.yDir === yAction!.direction;
      });

      if (diagonalActionId) {
        const action = commandRegistry.getAction(diagonalActionId);
        if (action && (!action.isEnabled || action.isEnabled())) {
          const diagonalMeta = DIAGONAL_JOG_ACTIONS[diagonalActionId];

          // Check if previous jog was continuous (long press) before cleanup
          let wasLongPress = false;

          // Cancel and cleanup existing X axis state
          if (xAction.eventCode !== eventCode) {
            const xState = this.jogStates.get(xAction.eventCode);
            if (xState && !xState.finished) {
              if (xState.longPressActive) {
                wasLongPress = true;
              }
              xState.cancelled = true;
              xState.handledShortStep = true;
              if (xState.timerId !== null) {
                clearTimeout(xState.timerId);
                xState.timerId = null;
              }
              if (xState.longPressActive && xState.session) {
                this.stopContinuousJog(xAction.eventCode, xState, 'transition-to-diagonal');
              } else {
                this.cleanupJogState(xAction.eventCode, xState);
              }
            }
          }
          // Cancel and cleanup existing Y axis state
          if (yAction.eventCode !== eventCode) {
            const yState = this.jogStates.get(yAction.eventCode);
            if (yState && !yState.finished) {
              if (yState.longPressActive) {
                wasLongPress = true;
              }
              yState.cancelled = true;
              yState.handledShortStep = true;
              if (yState.timerId !== null) {
                clearTimeout(yState.timerId);
                yState.timerId = null;
              }
              if (yState.longPressActive && yState.session) {
                this.stopContinuousJog(yAction.eventCode, yState, 'transition-to-diagonal');
              } else {
                this.cleanupJogState(yAction.eventCode, yState);
              }
            }
          }

          const diagonalState: ActiveJogState = {
            xDir: diagonalMeta.xDir,
            yDir: diagonalMeta.yDir,
            xEventCode: xAction.eventCode,
            xCombo: xAction.combo,
            yEventCode: yAction.eventCode,
            yCombo: yAction.combo,
            combo: `${xAction.combo}+${yAction.combo}`,
            timerId: null,
            longPressTriggered: false,
            longPressActive: false,
            cancelled: false,
            session: null,
            promise: null,
            handledShortStep: false,
            finished: false
          };

          this.jogStates.set(diagonalKey, diagonalState);
          this.activeDiagonalKey = diagonalKey;

          // If previous jog was continuous, start diagonal continuous jog immediately
          // without waiting for the long press delay (key was already held long enough)
          if (wasLongPress) {
            this.beginLongPress(diagonalKey, diagonalState);
          } else {
            diagonalState.timerId = window.setTimeout(() => {
              this.beginLongPress(diagonalKey, diagonalState);
            }, JOG_LONG_PRESS_DELAY_MS);
          }

          return true;
        }
      }
    }

    return false;
  }

  private handleKeyUp = (event: KeyboardEvent) => {
    const combo = comboFromEvent(event);
    const actionId = combo ? keyBindingStore.getBinding(combo) : undefined;
    const eventCode = event.code || combo || '';

    this.heldKeys.delete(eventCode);

    const longPressState = this.longPressStates.get(eventCode);
    if (longPressState) {
      if (!longPressState.completed) {
        longPressState.cancelled = true;
        if (longPressState.timerId !== null) {
          clearTimeout(longPressState.timerId);
          longPressState.timerId = null;
        }
      }
      this.longPressStates.delete(eventCode);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const state = this.jogStates.get(eventCode);
    if (!state) {
      if (actionId && (JOG_ACTIONS[actionId] || DIAGONAL_JOG_ACTIONS[actionId])) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.checkAndReleaseDiagonalOnKeyUp(actionId);
      return;
    }

    if (state.finished) {
      this.jogStates.delete(eventCode);
      if (actionId && (JOG_ACTIONS[actionId] || DIAGONAL_JOG_ACTIONS[actionId])) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.checkAndReleaseDiagonalOnKeyUp(actionId);
      return;
    }

    state.cancelled = true;

    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
      this.runShortJog(eventCode, state);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!state.longPressTriggered) {
      this.cleanupJogState(eventCode, state);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (state.longPressActive && state.session) {
      this.stopContinuousJog(eventCode, state);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (state.promise) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.cleanupJogState(eventCode, state);
    event.preventDefault();
    event.stopPropagation();
  };

  private checkAndReleaseDiagonalOnKeyUp(actionId: string | undefined): void {
    if (!actionId) {
      return;
    }

    const jogMeta = JOG_ACTIONS[actionId];
    if (!jogMeta || jogMeta.axis === 'Z') {
      return;
    }

    const diagonalKeys = Array.from(this.jogStates.keys()).filter(key => key.startsWith('diagonal-'));
    for (const diagonalKey of diagonalKeys) {
      const state = this.jogStates.get(diagonalKey);
      if (state && !state.finished) {
        // Determine which axis key is still held (the one NOT being released)
        const releasedAxis = jogMeta.axis; // 'X' or 'Y'
        const remainingAxis = releasedAxis === 'X' ? 'Y' : 'X';
        const remainingEventCode = remainingAxis === 'X' ? state.xEventCode : state.yEventCode;
        const remainingCombo = remainingAxis === 'X' ? state.xCombo : state.yCombo;
        const remainingDirection = remainingAxis === 'X' ? state.xDir : state.yDir;

        state.cancelled = true;

        const startRemainingAxisJog = () => {
          // Only start if the remaining key is actually still held
          if (!remainingEventCode || !this.heldKeys.has(remainingEventCode)) {
            return;
          }
          if (remainingCombo && remainingDirection !== undefined) {
            const newState: ActiveJogState = {
              axis: remainingAxis,
              direction: remainingDirection,
              combo: remainingCombo,
              timerId: null,
              longPressTriggered: false,
              longPressActive: false,
              cancelled: false,
              session: null,
              promise: null,
              handledShortStep: false,
              finished: false
            };

            this.jogStates.set(remainingEventCode, newState);

            // Start continuous jog immediately since key is already being held
            this.beginLongPress(remainingEventCode, newState);
          }
        };

        if (state.timerId !== null) {
          clearTimeout(state.timerId);
          state.timerId = null;
          // Short diagonal press - just do step jog, don't start continuous for remaining axis
          this.runShortJog(diagonalKey, state);
          return;
        }

        if (!state.longPressTriggered) {
          this.cleanupJogState(diagonalKey, state);
          // Not a long press, don't start continuous jog
          return;
        }

        if (state.longPressActive && state.session) {
          // Stop the diagonal jog, then start the single-axis jog
          const session = state.session;
          state.session = null;
          state.longPressActive = false;

          session
            .stop('transition-to-single-axis')
            .catch((error) => {
              console.error('Failed to stop diagonal jog session:', error);
            })
            .finally(() => {
              this.cleanupJogState(diagonalKey, state);
              startRemainingAxisJog();
            });
          return;
        }

        if (state.promise) {
          return;
        }

        this.cleanupJogState(diagonalKey, state);
        startRemainingAxisJog();
      }
    }
  }

  private handleWindowBlur = () => {
    this.heldKeys.clear();

    for (const [eventCode, longPressState] of Array.from(this.longPressStates.entries())) {
      if (!longPressState.completed) {
        longPressState.cancelled = true;
        if (longPressState.timerId !== null) {
          clearTimeout(longPressState.timerId);
          longPressState.timerId = null;
        }
      }
      this.longPressStates.delete(eventCode);
    }

    for (const [eventCode, state] of Array.from(this.jogStates.entries())) {
      if (state.finished) {
        this.jogStates.delete(eventCode);
        continue;
      }

      state.cancelled = true;

      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
        this.cleanupJogState(eventCode, state);
        continue;
      }

      if (!state.longPressTriggered) {
        this.cleanupJogState(eventCode, state);
        continue;
      }

      if (state.longPressActive && state.session) {
        this.stopContinuousJog(eventCode, state, 'keyboard-blur');
        continue;
      }

      if (state.promise) {
        // Wait for acknowledgement; beginLongPress will observe cancellation and clean up
        continue;
      }

      this.cleanupJogState(eventCode, state);
    }
  };

  private executeLongPressAction(eventCode: string, state: ActiveLongPressState): void {
    if (state.cancelled) {
      this.longPressStates.delete(eventCode);
      return;
    }

    state.timerId = null;
    state.completed = true;

    commandRegistry.execute(state.actionId).catch((error) => {
      console.error(`Failed to execute long press action '${state.actionId}':`, error);
    });
  };

  private beginLongPress(eventCode: string, state: ActiveJogState): void {
    if (state.finished) {
      return;
    }

    state.timerId = null;
    state.longPressTriggered = true;

    const promise = state.axis !== undefined && state.direction !== undefined
      ? startContinuousJogSession(state.axis, state.direction)
      : startContinuousDiagonalJogSession(state.xDir!, state.yDir!);
    state.promise = promise;

    promise
      .then((session) => {
        if (state.finished) {
          if (session) {
            session.stop('state-already-finished').catch(() => {});
          }
          return;
        }
        state.session = session;
        state.longPressActive = Boolean(session);

        if (!state.cancelled) {
          return;
        }

        if (session) {
          this.stopContinuousJog(eventCode, state);
        } else {
          this.cleanupJogState(eventCode, state);
        }
      })
      .catch((error) => {
        console.error('Failed to start continuous jog session:', error);
        if (state.finished) {
          return;
        }

        state.longPressActive = false;
        if (state.cancelled) {
          this.cleanupJogState(eventCode, state);
        }
      })
      .finally(() => {
        if (!state.finished) {
          state.promise = null;
        }
      });
  }

  private runShortJog(eventCode: string, state: ActiveJogState): void {
    if (state.finished) {
      return;
    }

    if (state.handledShortStep) {
      this.cleanupJogState(eventCode, state);
      return;
    }

    state.handledShortStep = true;

    const jogPromise = state.axis !== undefined && state.direction !== undefined
      ? performJogStep(state.axis, state.direction)
      : performDiagonalJogStep(state.xDir!, state.yDir!);

    jogPromise
      .catch((error) => {
        console.error('Failed to execute jog step via keyboard shortcut:', error);
      })
      .finally(() => {
        this.cleanupJogState(eventCode, state);
      });
  }

  private stopContinuousJog(eventCode: string, state: ActiveJogState, reason = 'keyboard-stop'): void {
    if (state.finished) {
      return;
    }

    const session = state.session;
    state.session = null;
    state.longPressActive = false;

    if (!session) {
      this.cleanupJogState(eventCode, state);
      return;
    }

    session
      .stop(reason)
      .catch((error) => {
        console.error('Failed to stop continuous jog session:', error);
      })
      .finally(() => {
        this.cleanupJogState(eventCode, state);
      });
  }

  private cleanupJogState(eventCode: string, state: ActiveJogState): void {
    if (state.finished) {
      this.jogStates.delete(eventCode);
      if (this.activeDiagonalKey === eventCode) {
        this.activeDiagonalKey = null;
      }
      return;
    }

    state.finished = true;

    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    this.jogStates.delete(eventCode);

    if (this.activeDiagonalKey === eventCode) {
      this.activeDiagonalKey = null;
    }
  }

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });
    window.addEventListener('blur', this.handleWindowBlur);

    watchEffect(() => {
      this.enabled = keyBindingStore.isActive.value;
      if (!this.enabled) {
        this.handleWindowBlur();
      }
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('keyup', this.handleKeyUp, true);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.handleWindowBlur();
  }
}

let instance: KeyboardManager | null = null;

export function getKeyboardManager(): KeyboardManager {
  if (!instance) {
    instance = new KeyboardManager();
  }
  return instance;
}
