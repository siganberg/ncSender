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

import { api } from '@/lib/api';

const BASE_URL = `${api.baseUrl}/api/plugins`;

function buildUrl(path: string) {
  return `${BASE_URL}${path}`;
}

async function parseError(response: Response) {
  let message = `Request failed (${response.status})`;
  let errorData: any = null;

  try {
    const data = await response.json();
    errorData = data;
    if (data && typeof data.error === 'string') {
      message = data.error;
    }
  } catch {
    // Ignore JSON parsing errors
  }

  const error: any = new Error(message);
  error.response = {
    status: response.status,
    data: errorData
  };
  throw error;
}

export interface PluginUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string;
  message?: string;
}

export interface PluginListItem {
  id: string;
  name: string;
  version: string;
  author?: string;
  enabled: boolean;
  loaded: boolean;
  loadedAt?: string;
  installedAt?: string;
  hasConfig: boolean;
  hasIcon: boolean;
  category: string;
  priority?: number;
  repository?: string;
  updateInfo?: PluginUpdateInfo | null;
}

export interface ToolMenuItem {
  pluginId: string;
  label: string;
  clientOnly?: boolean;
  icon?: string | null;
}

export async function fetchPlugins(): Promise<PluginListItem[]> {
  const response = await fetch(buildUrl(''));
  if (!response.ok) {
    await parseError(response);
  }
  return await response.json();
}

export async function reloadPlugin(pluginId: string): Promise<void> {
  const response = await fetch(buildUrl(`/${pluginId}/reload`), {
    method: 'POST'
  });
  if (!response.ok) {
    await parseError(response);
  }
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  const endpoint = enabled ? 'enable' : 'disable';
  const response = await fetch(buildUrl(`/${pluginId}/${endpoint}`), {
    method: 'POST'
  });
  if (!response.ok) {
    await parseError(response);
  }
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const response = await fetch(buildUrl(`/${pluginId}`), {
    method: 'DELETE'
  });
  if (!response.ok) {
    await parseError(response);
  }
}

export async function installPlugin(file: File): Promise<void> {
  const formData = new FormData();
  formData.append('plugin', file);

  const response = await fetch(buildUrl('/install'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    await parseError(response);
  }
}

export async function fetchPluginConfigUI(pluginId: string): Promise<string> {
  const response = await fetch(buildUrl(`/${pluginId}/config-ui`));
  if (!response.ok) {
    await parseError(response);
  }

  const data = await response.json();
  return data?.configUI ?? '';
}

export async function fetchToolMenuItems(): Promise<ToolMenuItem[]> {
  const response = await fetch(buildUrl('/tool-menu-items'));
  if (!response.ok) {
    await parseError(response);
  }
  return await response.json();
}

interface ExecuteToolOptions {
  clientId?: string | null;
}

export async function executeToolMenuItem(
  pluginId: string,
  label: string,
  options: ExecuteToolOptions = {}
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.clientId) {
    headers['X-Client-ID'] = options.clientId;
  }

  const response = await fetch(buildUrl('/tool-menu-items/execute'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ pluginId, label })
  });

  if (!response.ok) {
    await parseError(response);
  }
}

export async function reorderPlugins(pluginIds: string[]): Promise<void> {
  const response = await fetch(buildUrl('/reorder'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pluginIds })
  });

  if (!response.ok) {
    await parseError(response);
  }
}

export async function checkPluginUpdate(pluginId: string): Promise<PluginUpdateInfo> {
  const response = await fetch(buildUrl(`/${pluginId}/check-update`));
  if (!response.ok) {
    await parseError(response);
  }
  return await response.json();
}

export async function updatePlugin(pluginId: string): Promise<void> {
  const response = await fetch(buildUrl(`/${pluginId}/update`), {
    method: 'POST'
  });
  if (!response.ok) {
    await parseError(response);
  }
}
