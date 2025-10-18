import { api } from '@/lib/api';

const BASE_URL = `${api.baseUrl}/api/plugins`;

function buildUrl(path: string) {
  return `${BASE_URL}${path}`;
}

async function parseError(response: Response) {
  let message = `Request failed (${response.status})`;
  try {
    const data = await response.json();
    if (data && typeof data.error === 'string') {
      message = data.error;
    }
  } catch {
    // Ignore JSON parsing errors
  }
  throw new Error(message);
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
