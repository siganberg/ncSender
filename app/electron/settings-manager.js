import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SETTINGS = {
  pauseBeforeStop: 500,
  connectionType: 'usb',
  baudRate: 115200,
  ip: '192.168.5.1',
  port: 23
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

function ensureSettingsFile() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    try {
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
