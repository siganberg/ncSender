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

export interface GamepadBinding {
  type: 'button' | 'axis';
  index: number;
  direction?: 'positive' | 'negative';
}

const AXIS_BINDING_THRESHOLD = 0.95; // High threshold for detecting new bindings
const AXIS_ACTIVE_THRESHOLD = 0.8; // Threshold for single axis movement (diagonal has priority at 0.3)
const FULL_STRENGTH_THRESHOLD = 0.95;

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
    if (value > AXIS_BINDING_THRESHOLD) {
      return {
        type: 'axis',
        index: i,
        direction: 'positive'
      };
    } else if (value < -AXIS_BINDING_THRESHOLD) {
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
      return value > AXIS_ACTIVE_THRESHOLD;
    } else {
      return value < -AXIS_ACTIVE_THRESHOLD;
    }
  }

  return false;
}

export function getAxisStrength(gamepad: Gamepad, axisIndex: number): number {
  return Math.abs(gamepad.axes[axisIndex] || 0);
}

export function isAxisAtFullStrength(gamepad: Gamepad, axisIndex: number): boolean {
  return getAxisStrength(gamepad, axisIndex) > FULL_STRENGTH_THRESHOLD;
}
