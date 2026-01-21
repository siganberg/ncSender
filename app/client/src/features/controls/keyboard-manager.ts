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
  performJogStep,
  performDiagonalJogStep,
  startContinuousJogSession,
  startContinuousDiagonalJogSession,
  type ContinuousJogSession
} from './actions';

const JOG_LONG_PRESS_DELAY_MS = 300;
const ACTION_LONG_PRESS_DELAY_MS = 1000;

interface HeldJogKey {
  axis: 'X' | 'Y' | 'Z';
  direction: 1 | -1;
  combo: string;
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

  // Simplified jog state
  private heldJogKeys = new Map<string, HeldJogKey>();
  private longPressTimer: number | null = null;
  private isLongPress = false;
  private activeSession: ContinuousJogSession | null = null;
  private sessionPromise: Promise<void> | null = null;
  private pendingJogStart = false;

  // For non-jog long press actions (Home, Start Job, etc.)
  private longPressStates = new Map<string, ActiveLongPressState>();

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
    const eventCode = event.code || combo;

    // Handle jog keys
    if (jogMeta) {
      event.preventDefault();
      event.stopPropagation();

      // Ignore key repeat (both browser auto-repeat and our own tracking)
      if (event.repeat || this.heldJogKeys.has(eventCode)) {
        return;
      }

      // Add to held keys
      this.heldJogKeys.set(eventCode, {
        axis: jogMeta.axis,
        direction: jogMeta.direction,
        combo
      });

      // Handle jog state change
      this.onJogKeysChanged();
      return;
    }

    // Handle non-jog long press actions
    if (action.requiresLongPress) {
      event.preventDefault();
      event.stopPropagation();

      if (this.longPressStates.has(eventCode)) {
        return;
      }

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

    // Regular action - execute immediately
    event.preventDefault();
    event.stopPropagation();
    commandRegistry.execute(actionId);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const combo = comboFromEvent(event);
    const eventCode = event.code || combo || '';

    // Handle non-jog long press key up
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

    // Handle jog key up
    if (this.heldJogKeys.has(eventCode)) {
      event.preventDefault();
      event.stopPropagation();

      this.heldJogKeys.delete(eventCode);
      this.onJogKeysChanged();
    }
  };

  private onJogKeysChanged(): void {
    const jogDirection = this.computeJogDirection();

    // No keys held or opposite keys cancel out
    if (!jogDirection) {
      this.stopAllJogs();
      return;
    }

    // Update snapshot for potential step jog (before timer fires)
    this.lastJogSnapshot = [...jogDirection.axes];

    // Keys are held - determine if short press or long press
    if (!this.isLongPress) {
      // Not yet in long press mode
      if (this.longPressTimer !== null) {
        // Timer already running - reset it for new key combo
        clearTimeout(this.longPressTimer);
      }

      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null;
        this.isLongPress = true;
        this.startContinuousJog();
      }, JOG_LONG_PRESS_DELAY_MS);
    } else {
      // Already in long press mode - transition to new direction
      this.startContinuousJog();
    }
  }

  private computeJogDirection(): { axes: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }> } | null {
    if (this.heldJogKeys.size === 0) {
      return null;
    }

    const axes: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }> = [];
    let hasXPlus = false, hasXMinus = false;
    let hasYPlus = false, hasYMinus = false;
    let hasZPlus = false, hasZMinus = false;

    for (const key of this.heldJogKeys.values()) {
      if (key.axis === 'X') {
        if (key.direction === 1) hasXPlus = true;
        else hasXMinus = true;
      } else if (key.axis === 'Y') {
        if (key.direction === 1) hasYPlus = true;
        else hasYMinus = true;
      } else if (key.axis === 'Z') {
        if (key.direction === 1) hasZPlus = true;
        else hasZMinus = true;
      }
    }

    // Check for opposite keys on same axis - cancel out
    if ((hasXPlus && hasXMinus) || (hasYPlus && hasYMinus) || (hasZPlus && hasZMinus)) {
      return null;
    }

    // Build axes array
    if (hasXPlus) axes.push({ axis: 'X', direction: 1 });
    else if (hasXMinus) axes.push({ axis: 'X', direction: -1 });

    if (hasYPlus) axes.push({ axis: 'Y', direction: 1 });
    else if (hasYMinus) axes.push({ axis: 'Y', direction: -1 });

    if (hasZPlus) axes.push({ axis: 'Z', direction: 1 });
    else if (hasZMinus) axes.push({ axis: 'Z', direction: -1 });

    return axes.length > 0 ? { axes } : null;
  }

  private stopAllJogs(): void {
    // Cancel any pending jog start
    this.pendingJogStart = false;

    // Cancel long press timer if running
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;

      // Timer was running = short press, send step jog
      const jogDirection = this.computeJogDirectionFromSnapshot();
      if (jogDirection) {
        this.sendStepJog(jogDirection.axes);
      }
    }

    // Stop active continuous jog session
    if (this.activeSession) {
      const session = this.activeSession;
      this.activeSession = null;
      session.stop('keyboard-stop').catch((error) => {
        console.error('Failed to stop jog session:', error);
      });
    }

    this.isLongPress = false;
  }

  // Snapshot of jog direction before keys were released (for step jog)
  private lastJogSnapshot: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }> | null = null;

  private computeJogDirectionFromSnapshot(): { axes: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }> } | null {
    if (this.lastJogSnapshot && this.lastJogSnapshot.length > 0) {
      return { axes: this.lastJogSnapshot };
    }
    return null;
  }

  private async sendStepJog(axes: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }>): Promise<void> {
    try {
      if (axes.length === 1) {
        await performJogStep(axes[0].axis, axes[0].direction);
      } else if (axes.length === 2) {
        // Diagonal step jog (X and Y only)
        const xAxis = axes.find(a => a.axis === 'X');
        const yAxis = axes.find(a => a.axis === 'Y');
        if (xAxis && yAxis) {
          await performDiagonalJogStep(xAxis.direction, yAxis.direction);
        }
      }
    } catch (error) {
      console.error('Failed to send step jog:', error);
    }
  }

  private startContinuousJog(): void {
    const jogDirection = this.computeJogDirection();
    if (!jogDirection) {
      return;
    }

    // Stop existing session if any
    if (this.activeSession) {
      const oldSession = this.activeSession;
      this.activeSession = null;
      oldSession.stop('transition').catch(() => {});
    }

    // If a session is being started, mark as pending - don't queue multiple starts
    if (this.sessionPromise) {
      this.pendingJogStart = true;
      return;
    }

    this.doStartContinuousJog(jogDirection.axes);
  }

  private doStartContinuousJog(axes: Array<{ axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }>): void {
    let sessionPromise: Promise<ContinuousJogSession | null>;

    if (axes.length === 1) {
      sessionPromise = startContinuousJogSession(axes[0].axis, axes[0].direction);
    } else if (axes.length === 2) {
      const xAxis = axes.find(a => a.axis === 'X');
      const yAxis = axes.find(a => a.axis === 'Y');
      if (xAxis && yAxis) {
        sessionPromise = startContinuousDiagonalJogSession(xAxis.direction, yAxis.direction);
      } else {
        return;
      }
    } else {
      return;
    }

    this.sessionPromise = sessionPromise
      .then((session) => {
        if (session) {
          // Check if still in long press mode and keys still held
          if (this.isLongPress && this.heldJogKeys.size > 0) {
            this.activeSession = session;
          } else {
            // Keys were released, stop the session
            session.stop('keys-released').catch(() => {});
          }
        }
      })
      .catch((error) => {
        console.error('Failed to start continuous jog session:', error);
      })
      .finally(() => {
        this.sessionPromise = null;

        // If direction changed while starting, start a new session with current direction
        if (this.pendingJogStart) {
          this.pendingJogStart = false;
          const currentDirection = this.computeJogDirection();
          if (currentDirection && this.isLongPress && this.heldJogKeys.size > 0) {
            // Stop the session that was just assigned before starting a new one
            if (this.activeSession) {
              const oldSession = this.activeSession;
              this.activeSession = null;
              oldSession.stop('transition').catch(() => {});
            }
            this.doStartContinuousJog(currentDirection.axes);
          }
        }
      }) as Promise<void>;
  }

  private handleWindowBlur = () => {
    // Clear all held keys
    this.heldJogKeys.clear();

    // Cancel any pending jog start
    this.pendingJogStart = false;

    // Stop all jogs
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    if (this.activeSession) {
      const session = this.activeSession;
      this.activeSession = null;
      session.stop('window-blur').catch(() => {});
    }

    this.isLongPress = false;
    this.lastJogSnapshot = null;

    // Cancel non-jog long press actions
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
