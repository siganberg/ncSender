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

const LONG_PRESS_DELAY_MS = 300;

interface ActiveJogState {
  axis?: 'X' | 'Y' | 'Z';
  direction?: 1 | -1;
  xDir?: 1 | -1;
  yDir?: 1 | -1;
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

class KeyboardManager {
  private enabled = false;
  private jogStates = new Map<string, ActiveJogState>();

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

      event.preventDefault();
      event.stopPropagation();

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
      }, LONG_PRESS_DELAY_MS);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commandRegistry.execute(actionId);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const combo = comboFromEvent(event);
    const actionId = combo ? keyBindingStore.getBinding(combo) : undefined;
    const eventCode = event.code || combo || '';

    const state = this.jogStates.get(eventCode);
    if (!state) {
      if (actionId && (JOG_ACTIONS[actionId] || DIAGONAL_JOG_ACTIONS[actionId])) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (state.finished) {
      this.jogStates.delete(eventCode);
      if (actionId && (JOG_ACTIONS[actionId] || DIAGONAL_JOG_ACTIONS[actionId])) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      // Long press requested but acknowledgement pending - rely on promise resolution to honour cancellation
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.cleanupJogState(eventCode, state);
    event.preventDefault();
    event.stopPropagation();
  };

  private handleWindowBlur = () => {
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
      return;
    }

    state.finished = true;

    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    this.jogStates.delete(eventCode);
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
