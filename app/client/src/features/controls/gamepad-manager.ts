import { watchEffect } from 'vue';
import { commandRegistry } from '@/lib/command-registry';
import { gamepadBindingStore } from './gamepad-binding-store';
import { keyBindingStore } from './key-binding-store';
import { parseGamepadBinding, isGamepadInputActive, type GamepadBinding } from './gamepad-utils';
import {
  JOG_ACTIONS,
  DIAGONAL_JOG_ACTIONS,
  performJogStep,
  performDiagonalJogStep,
  startContinuousJogSession,
  startContinuousDiagonalJogSession,
  type ContinuousJogSession
} from './actions';

const LONG_PRESS_DELAY_MS = 300;
const POLL_INTERVAL_MS = 16;

interface ActiveJogState {
  axis?: 'X' | 'Y' | 'Z';
  direction?: 1 | -1;
  xDir?: 1 | -1;
  yDir?: 1 | -1;
  bindingKey: string;
  timerId: number | null;
  longPressTriggered: boolean;
  longPressActive: boolean;
  cancelled: boolean;
  session: ContinuousJogSession | null;
  promise: Promise<ContinuousJogSession | null> | null;
  handledShortStep: boolean;
  finished: boolean;
}

class GamepadManager {
  private enabled = false;
  private pollInterval: number | null = null;
  private jogStates = new Map<string, ActiveJogState>();
  private previousButtonStates = new Map<string, boolean>();
  private actionsExecutedThisFrame = new Set<string>();

  private pollGamepads = () => {
    if (!this.enabled || keyBindingStore.isCaptureMode() || keyBindingStore.isControlsTabActive()) {
      return;
    }

    this.actionsExecutedThisFrame.clear();

    const gamepads = navigator.getGamepads();
    const currentButtonStates = new Map<string, boolean>();

    for (const gamepad of gamepads) {
      if (!gamepad) {
        continue;
      }

      const bindings = gamepadBindingStore.getAllBindings();
      const activeJogActions = new Map<string, { axis: 'X' | 'Y' | 'Z', direction: 1 | -1, bindingKey: string }>();

      for (const [actionId, bindingStr] of Object.entries(bindings)) {
        if (!bindingStr) {
          continue;
        }

        const binding = parseGamepadBinding(bindingStr);
        if (!binding) {
          continue;
        }

        const bindingKey = `${gamepad.index}-${bindingStr}`;
        const isActive = isGamepadInputActive(gamepad, binding);
        const wasActive = this.previousButtonStates.get(bindingKey) || false;

        currentButtonStates.set(bindingKey, isActive);

        if (isActive) {
          const jogMeta = JOG_ACTIONS[actionId];
          if (jogMeta) {
            activeJogActions.set(actionId, { axis: jogMeta.axis, direction: jogMeta.direction, bindingKey });
          }
        }
      }

      const isDiagonal = this.handleDiagonalJogs(gamepad.index, activeJogActions);

      for (const [actionId, bindingStr] of Object.entries(bindings)) {
        if (!bindingStr) {
          continue;
        }

        const binding = parseGamepadBinding(bindingStr);
        if (!binding) {
          continue;
        }

        const bindingKey = `${gamepad.index}-${bindingStr}`;
        const isActive = currentButtonStates.get(bindingKey) || false;
        const wasActive = this.previousButtonStates.get(bindingKey) || false;

        const jogMeta = JOG_ACTIONS[actionId];
        const shouldSkipDueTodiagonal = isDiagonal && jogMeta && (jogMeta.axis === 'X' || jogMeta.axis === 'Y');

        if (isActive && !wasActive && !shouldSkipDueTodiagonal) {
          this.handleGamepadButtonDown(actionId, bindingKey, binding);
        } else if (!isActive && wasActive) {
          this.handleGamepadButtonUp(actionId, bindingKey);
        }
      }
    }

    this.previousButtonStates = currentButtonStates;
  };

  private handleDiagonalJogs(gamepadIndex: number, activeJogActions: Map<string, { axis: 'X' | 'Y' | 'Z', direction: 1 | -1, bindingKey: string }>): boolean {
    let xAction: { actionId: string, direction: 1 | -1, bindingKey: string } | null = null;
    let yAction: { actionId: string, direction: 1 | -1, bindingKey: string } | null = null;

    for (const [actionId, meta] of activeJogActions.entries()) {
      if (meta.axis === 'X') {
        xAction = { actionId, direction: meta.direction, bindingKey: meta.bindingKey };
      } else if (meta.axis === 'Y') {
        yAction = { actionId, direction: meta.direction, bindingKey: meta.bindingKey };
      }
    }

    if (xAction && yAction) {
      const diagonalKey = `${gamepadIndex}-diagonal-${xAction.direction}-${yAction.direction}`;

      const diagonalActionId = Object.keys(DIAGONAL_JOG_ACTIONS).find(id => {
        const meta = DIAGONAL_JOG_ACTIONS[id];
        return meta.xDir === xAction!.direction && meta.yDir === yAction!.direction;
      });

      if (diagonalActionId) {
        const action = commandRegistry.getAction(diagonalActionId);
        if (action && (!action.isEnabled || action.isEnabled())) {
          const diagonalMeta = DIAGONAL_JOG_ACTIONS[diagonalActionId];

          if (!this.jogStates.has(diagonalKey)) {
            const wasActive = this.previousButtonStates.get(diagonalKey) || false;
            this.previousButtonStates.set(diagonalKey, true);

            if (!wasActive) {
              const state: ActiveJogState = {
                xDir: diagonalMeta.xDir,
                yDir: diagonalMeta.yDir,
                bindingKey: diagonalKey,
                timerId: null,
                longPressTriggered: false,
                longPressActive: false,
                cancelled: false,
                session: null,
                promise: null,
                handledShortStep: false,
                finished: false
              };

              this.jogStates.set(diagonalKey, state);

              state.timerId = window.setTimeout(() => {
                this.beginLongPress(diagonalKey, state);
              }, LONG_PRESS_DELAY_MS);
            }
          }
        }
      }

      return true;
    } else {
      const diagonalKeys = Array.from(this.jogStates.keys()).filter(key =>
        key.startsWith(`${gamepadIndex}-diagonal-`)
      );

      for (const diagonalKey of diagonalKeys) {
        const state = this.jogStates.get(diagonalKey);
        if (state && !state.finished) {
          this.handleGamepadButtonUp('', diagonalKey);
        }
      }

      return false;
    }
  }

  private handleGamepadButtonDown(actionId: string, bindingKey: string, binding: GamepadBinding): void {
    if (this.actionsExecutedThisFrame.has(actionId)) {
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

    if (jogMeta || diagonalJogMeta) {
      if (this.jogStates.has(bindingKey)) {
        return;
      }

      const state: ActiveJogState = jogMeta
        ? {
            axis: jogMeta.axis,
            direction: jogMeta.direction,
            bindingKey,
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
            bindingKey,
            timerId: null,
            longPressTriggered: false,
            longPressActive: false,
            cancelled: false,
            session: null,
            promise: null,
            handledShortStep: false,
            finished: false
          };

      this.jogStates.set(bindingKey, state);

      state.timerId = window.setTimeout(() => {
        this.beginLongPress(bindingKey, state);
      }, LONG_PRESS_DELAY_MS);
      return;
    }

    this.actionsExecutedThisFrame.add(actionId);
    commandRegistry.execute(actionId);
  }

  private handleGamepadButtonUp(actionId: string, bindingKey: string): void {
    const state = this.jogStates.get(bindingKey);
    if (!state) {
      return;
    }

    if (state.finished) {
      this.jogStates.delete(bindingKey);
      return;
    }

    state.cancelled = true;

    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
      this.runShortJog(bindingKey, state);
      return;
    }

    if (!state.longPressTriggered) {
      this.cleanupJogState(bindingKey, state);
      return;
    }

    if (state.longPressActive && state.session) {
      this.stopContinuousJog(bindingKey, state);
      return;
    }

    if (state.promise) {
      return;
    }

    this.cleanupJogState(bindingKey, state);
  }

  private beginLongPress(bindingKey: string, state: ActiveJogState): void {
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
          return;
        }
        state.session = session;
        state.longPressActive = Boolean(session);

        if (!state.cancelled) {
          return;
        }

        if (session) {
          this.stopContinuousJog(bindingKey, state);
        } else {
          this.cleanupJogState(bindingKey, state);
        }
      })
      .catch((error) => {
        console.error('Failed to start continuous jog session:', JSON.stringify(error));
        if (state.finished) {
          return;
        }

        state.longPressActive = false;
        if (state.cancelled) {
          this.cleanupJogState(bindingKey, state);
        }
      })
      .finally(() => {
        if (!state.finished) {
          state.promise = null;
        }
      });
  }

  private runShortJog(bindingKey: string, state: ActiveJogState): void {
    if (state.finished) {
      return;
    }

    if (state.handledShortStep) {
      this.cleanupJogState(bindingKey, state);
      return;
    }

    state.handledShortStep = true;

    const jogPromise = state.axis !== undefined && state.direction !== undefined
      ? performJogStep(state.axis, state.direction)
      : performDiagonalJogStep(state.xDir!, state.yDir!);

    jogPromise
      .catch((error) => {
        console.error('Failed to execute jog step via gamepad:', JSON.stringify(error));
      })
      .finally(() => {
        this.cleanupJogState(bindingKey, state);
      });
  }

  private stopContinuousJog(bindingKey: string, state: ActiveJogState, reason = 'gamepad-stop'): void {
    if (state.finished) {
      return;
    }

    const session = state.session;
    state.session = null;
    state.longPressActive = false;

    if (!session) {
      this.cleanupJogState(bindingKey, state);
      return;
    }

    session
      .stop(reason)
      .catch((error) => {
        console.error('Failed to stop continuous jog session:', JSON.stringify(error));
      })
      .finally(() => {
        this.cleanupJogState(bindingKey, state);
      });
  }

  private cleanupJogState(bindingKey: string, state: ActiveJogState): void {
    if (state.finished) {
      this.jogStates.delete(bindingKey);
      return;
    }

    state.finished = true;

    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    this.jogStates.delete(bindingKey);
  }

  private handleDisconnect = () => {
    for (const [bindingKey, state] of Array.from(this.jogStates.entries())) {
      if (state.finished) {
        this.jogStates.delete(bindingKey);
        continue;
      }

      state.cancelled = true;

      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
        this.cleanupJogState(bindingKey, state);
        continue;
      }

      if (!state.longPressTriggered) {
        this.cleanupJogState(bindingKey, state);
        continue;
      }

      if (state.longPressActive && state.session) {
        this.stopContinuousJog(bindingKey, state, 'gamepad-disconnect');
        continue;
      }

      if (state.promise) {
        continue;
      }

      this.cleanupJogState(bindingKey, state);
    }
  };

  constructor() {
    this.pollInterval = window.setInterval(this.pollGamepads, POLL_INTERVAL_MS);
    window.addEventListener('gamepaddisconnected', this.handleDisconnect);
    window.addEventListener('blur', this.handleDisconnect);

    watchEffect(() => {
      this.enabled = keyBindingStore.isActive.value;
      if (!this.enabled) {
        this.handleDisconnect();
      }
    });
  }

  dispose(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    window.removeEventListener('gamepaddisconnected', this.handleDisconnect);
    window.removeEventListener('blur', this.handleDisconnect);
    this.handleDisconnect();
  }
}

let instance: GamepadManager | null = null;

export function getGamepadManager(): GamepadManager {
  if (!instance) {
    instance = new GamepadManager();
  }
  return instance;
}
