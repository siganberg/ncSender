import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_SETTINGS = {
  pauseBeforeStop: 500,
  connectionType: 'usb',
  baudRate: 115200,
  ip: '192.168.5.1',
  port: 23
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
  ensureSettingsFile();

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

export { SETTINGS_PATH, DEFAULT_SETTINGS };
