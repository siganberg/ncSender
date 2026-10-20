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

import { commandRegistry } from '@/lib/command-registry';
import { api } from '@/lib/api';
import { fetchToolMenuItems, executeToolMenuItem, type ToolMenuItem } from './api';

const PLUGIN_ACTION_PREFIX = 'Plugin:';
const registeredPluginActions = new Set<string>();
let listening = false;

const actionIdFor = (item: ToolMenuItem) => `${PLUGIN_ACTION_PREFIX}${item.pluginId}:${item.id || item.label}`;

function registerPluginActions(items: ToolMenuItem[]): void {
  const nextIds = new Set(items.map(actionIdFor));

  for (const actionId of Array.from(registeredPluginActions)) {
    if (!nextIds.has(actionId)) {
      commandRegistry.unregister(actionId);
      registeredPluginActions.delete(actionId);
    }
  }

  items.forEach((item) => {
    const actionId = actionIdFor(item);
    commandRegistry.register({
      id: actionId,
      label: item.label,
      group: 'Plugins',
      description: `Open ${item.label} (${item.pluginId})`,
      handler: async () => {
        await executeToolMenuItem(item.pluginId, item.label, { clientId: api.clientId });
      }
    });
    registeredPluginActions.add(actionId);
  });
}

export async function syncPluginActions(): Promise<void> {
  try {
    registerPluginActions(await fetchToolMenuItems());
  } catch (error) {
    console.warn('Failed to load plugin actions for shortcuts:', error);
  }

  if (!listening) {
    listening = true;
    api.on('plugins:tools-changed', () => {
      syncPluginActions();
    });
  }
}
