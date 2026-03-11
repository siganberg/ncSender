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

import { reactive, readonly } from 'vue';

export type CommandHandler = () => void | Promise<void>;

export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  group?: string;
  handler: CommandHandler;
  isEnabled?: () => boolean;
  requiresLongPress?: boolean;
}

interface CommandState {
  actions: Record<string, CommandAction>;
}

class CommandRegistry {
  private state = reactive<CommandState>({
    actions: {}
  });

  register(action: CommandAction): void {
    if (!action || !action.id) {
      throw new Error('Invalid command action');
    }
    this.state.actions[action.id] = action;
  }

  unregister(actionId: string): void {
    if (!actionId) {
      return;
    }
    delete this.state.actions[actionId];
  }

  has(actionId: string): boolean {
    return Boolean(this.state.actions[actionId]);
  }

  getAction(actionId: string): CommandAction | undefined {
    return this.state.actions[actionId];
  }

  async execute(actionId: string): Promise<boolean> {
    const action = this.state.actions[actionId];
    if (!action) {
      return false;
    }
    if (action.isEnabled && !action.isEnabled()) {
      return false;
    }

    try {
      await action.handler();
      return true;
    } catch (error) {
      console.error(`Command '${actionId}' failed:`, error);
      return false;
    }
  }

  listActions(): CommandAction[] {
    return Object.values(this.state.actions);
  }

  getState(): Readonly<CommandState> {
    return readonly(this.state);
  }
}

export const commandRegistry = new CommandRegistry();
