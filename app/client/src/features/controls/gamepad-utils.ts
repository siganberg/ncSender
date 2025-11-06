export interface GamepadBinding {
  type: 'button' | 'axis';
  index: number;
  direction?: 'positive' | 'negative';
}

const AXIS_THRESHOLD = 0.5;

export function formatGamepadBinding(binding: GamepadBinding): string {
  if (binding.type === 'button') {
    return `Button ${binding.index}`;
  }
  const direction = binding.direction === 'positive' ? '+' : '-';
  return `Axis ${binding.index}${direction}`;
}

export function parseGamepadBinding(str: string): GamepadBinding | null {
  if (!str) {
    return null;
  }

  const buttonMatch = str.match(/^Button (\d+)$/);
  if (buttonMatch) {
    return {
      type: 'button',
      index: parseInt(buttonMatch[1], 10)
    };
  }

  const axisMatch = str.match(/^Axis (\d+)([+-])$/);
  if (axisMatch) {
    return {
      type: 'axis',
      index: parseInt(axisMatch[1], 10),
      direction: axisMatch[2] === '+' ? 'positive' : 'negative'
    };
  }

  return null;
}

export function detectGamepadInput(gamepad: Gamepad): GamepadBinding | null {
  for (let i = 0; i < gamepad.buttons.length; i++) {
    if (gamepad.buttons[i].pressed) {
      return {
        type: 'button',
        index: i
      };
    }
  }

  for (let i = 0; i < gamepad.axes.length; i++) {
    const value = gamepad.axes[i];
    if (value > AXIS_THRESHOLD) {
      return {
        type: 'axis',
        index: i,
        direction: 'positive'
      };
    } else if (value < -AXIS_THRESHOLD) {
      return {
        type: 'axis',
        index: i,
        direction: 'negative'
      };
    }
  }

  return null;
}

export function isGamepadInputActive(gamepad: Gamepad, binding: GamepadBinding): boolean {
  if (binding.type === 'button') {
    return gamepad.buttons[binding.index]?.pressed || false;
  }

  if (binding.type === 'axis') {
    const value = gamepad.axes[binding.index];
    if (binding.direction === 'positive') {
      return value > AXIS_THRESHOLD;
    } else {
      return value < -AXIS_THRESHOLD;
    }
  }

  return false;
}
