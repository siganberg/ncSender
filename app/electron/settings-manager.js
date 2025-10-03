import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_SETTINGS = {
  pauseBeforeStop: 500,
  ip: '192.168.5.1',
  port: 23,
  serverPort: 8090,
  usbPort: '',
  theme: 'dark',
  workspace: 'G54',
  defaultGcodeView: 'iso',
  accentColor: '#1abc9c',
  gradientColor: '#34d399',
  autoClearConsole: true,
  consoleBufferSize: 1000,
  lastLoadedFile: null
};

function getUserDataDir() {
  const platform = os.platform();
  const appName = 'ncSender';

  switch (platform) {
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming', appName);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    case 'linux':
      return path.join(os.homedir(), '.config', appName);
    default:
      return path.join(os.homedir(), `.${appName}`);
  }
}

const SETTINGS_PATH = path.join(getUserDataDir(), 'settings.json');

function ensureSettingsFile() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    try {
      // Ensure directory exists
      const settingsDir = path.dirname(SETTINGS_PATH);
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to create default settings file:', error);
    }
  }
}

export function readSettings() {
  // Check if settings file exists, but don't create it
  if (!fs.existsSync(SETTINGS_PATH)) {
    return null; // Indicate that no settings file exists
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (error) {
    console.error('Failed to load settings. Using defaults.', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSetting(key, fallback) {
  const settings = readSettings();

  // If no settings file exists, return undefined (no fallbacks)
  if (settings === null) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(settings, key)) {
    const value = settings[key];
    if (value !== undefined) {
      return value;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return DEFAULT_SETTINGS[key];
  }
  return undefined;
}

export function saveSettings(newSettings) {
  ensureSettingsFile();

  try {
    const currentSettings = readSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updatedSettings, null, 2), 'utf8');
    return updatedSettings;
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

export function saveConnectionSettings(connectionSettings) {
  const settingsToSave = {
    connectionType: connectionSettings.type?.toLowerCase() || 'usb',
    baudRate: parseInt(connectionSettings.baudRate) || 115200,
    ip: connectionSettings.ipAddress || '192.168.5.1',
    port: parseInt(connectionSettings.port) || 23
  };

  return saveSettings(settingsToSave);
}

export function removeSetting(key) {
  ensureSettingsFile();

  try {
    const currentSettings = readSettings();
    if (currentSettings && Object.prototype.hasOwnProperty.call(currentSettings, key)) {
      const { [key]: _, ...updatedSettings } = currentSettings;
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updatedSettings, null, 2), 'utf8');
      return updatedSettings;
    }
    return currentSettings;
  } catch (error) {
    console.error(`Failed to remove setting '${key}':`, error);
    throw error;
  }
}

export { SETTINGS_PATH, DEFAULT_SETTINGS };
