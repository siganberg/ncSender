import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

const DEFAULT_SETTINGS = {
  pauseBeforeStop: 500,
  connection: {
    type: 'usb',
    ip: '192.168.5.1',
    port: 23,
    serverPort: 8090,
    usbPort: '',
    baudRate: 115200
  },
  theme: 'dark',
  workspace: 'G54',
  defaultGcodeView: 'top',
  autoFit : false,
  accentColor: '#1abc9c',
  gradientColor: '#34d399',
  autoClearConsole: true,
  debugLogging: false,
  unitsPreference: 'metric',
  homeLocation: 'back-left',
  keyboardBindings: {
    ArrowUp: 'JogYPlus',
    ArrowDown: 'JogYMinus',
    ArrowLeft: 'JogXMinus',
    ArrowRight: 'JogXPlus',
    PageUp: 'JogZPlus',
    PageDown: 'JogZMinus',
    Escape: 'JogCancel'
  },
  keyboard: {
    shortcutsEnabled: true,
    step: 1,
    xyFeedRate: 3000,
    zFeedRate: 1500
  },
  features: {
    keyboardShortcuts: true
  },
  consoleBufferSize: 1000,
  lastLoadedFile: null,
  enableStateDeltaBroadcast: true,
  probe: {
    type: 'autozero-touch',
    probingAxis: 'Z',
    selectedCorner: 'BottomLeft',
    typeInitialized: false,
    requireConnectionTest: false,
    bitDiameters: [2, 3.175, 6.35, 9.525, 12],
    '3d-probe': {
      ballPointDiameter: 6,
      zPlunge: 3,
      zOffset: 0,
      rapidMovement: 2000,
      xDimension: 100,
      yDimension: 100,
      probeZFirst: false
    },
    'standard-block': {
      zThickness: 25,
      xyThickness: 50,
      zProbeDistance: 3
    }
  },
  tool: {
    count: 0,
    source: null,
    tls: false,
    manual: false
  },
  plugins: {
    allowPriorityReordering: false
  },
  useDoorAsPause : true
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
      log('Failed to create default settings file:', error);
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
    const parsedObject = parsed && typeof parsed === 'object' ? parsed : {};
    const merged = { ...DEFAULT_SETTINGS, ...parsedObject };

    const parsedProbe = parsedObject.probe && typeof parsedObject.probe === 'object'
      ? parsedObject.probe
      : {};

    const mergedProbe = {
      ...DEFAULT_SETTINGS.probe,
      ...parsedProbe,
      '3d-probe': {
        ...DEFAULT_SETTINGS.probe['3d-probe'],
        ...(parsedProbe['3d-probe'] || {})
      },
      'standard-block': {
        ...DEFAULT_SETTINGS.probe['standard-block'],
        ...(parsedProbe['standard-block'] || {})
      }
    };

    if (mergedProbe.typeInitialized !== true && mergedProbe.type === '3d-probe') {
      mergedProbe.type = 'autozero-touch';
    }

    merged.probe = mergedProbe;

    const parsedKeyboard = parsedObject.keyboard && typeof parsedObject.keyboard === 'object'
      ? parsedObject.keyboard
      : {};

    merged.keyboard = {
      ...DEFAULT_SETTINGS.keyboard,
      ...parsedKeyboard
    };

    const parsedFeatures = parsedObject.features && typeof parsedObject.features === 'object'
      ? parsedObject.features
      : {};

    merged.features = {
      ...DEFAULT_SETTINGS.features,
      ...parsedFeatures
    };

    // Migrate old numberOfTools to new tool.count structure
    const parsedTool = parsedObject.tool && typeof parsedObject.tool === 'object'
      ? parsedObject.tool
      : {};

    merged.tool = {
      ...DEFAULT_SETTINGS.tool,
      ...parsedTool
    };

    // Migration: convert old numberOfTools to tool.count
    if (parsedObject.numberOfTools !== undefined && parsedObject.tool === undefined) {
      merged.tool.count = parsedObject.numberOfTools;
    }

    const parsedConnection = parsedObject.connection;
    const hasCustomConnection = parsedConnection && typeof parsedConnection === 'object';
    const normalizedConnection = {
      ...DEFAULT_SETTINGS.connection,
      ...(hasCustomConnection ? parsedConnection : {})
    };

    // Support legacy property name
    if (
      hasCustomConnection &&
      typeof parsedConnection.connectionType === 'string' &&
      !parsedConnection.type
    ) {
      normalizedConnection.type = parsedConnection.connectionType.toLowerCase();
    }

    // If user provided a connection object but omitted type entirely, treat as unconfigured
    const typeProvided = hasCustomConnection &&
      (Object.prototype.hasOwnProperty.call(parsedConnection, 'type') ||
       Object.prototype.hasOwnProperty.call(parsedConnection, 'connectionType'));

    if (!typeProvided) {
      delete normalizedConnection.type;
    } else if (typeof normalizedConnection.type === 'string') {
      normalizedConnection.type = normalizedConnection.type.toLowerCase();
    }

    delete normalizedConnection.connectionType;

    merged.connection = normalizedConnection;
    return merged;
  } catch (error) {
    log('Failed to load settings. Using defaults.', error);
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

    if (updatedSettings.connection && typeof updatedSettings.connection === 'object') {
      delete updatedSettings.ip;
      delete updatedSettings.port;
      delete updatedSettings.serverPort;
      delete updatedSettings.usbPort;
      delete updatedSettings.connectionType;
      delete updatedSettings.connection.connectionType;
    }
    delete updatedSettings.baudRate;

    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updatedSettings, null, 2), 'utf8');
    return updatedSettings;
  } catch (error) {
    log('Failed to save settings:', error);
    throw error;
  }
}

export function saveConnectionSettings(connectionSettings) {
  const parsedBaudRate = parseInt(connectionSettings.baudRate, 10);
  const parsedPort = parseInt(connectionSettings.port, 10);
  const parsedServerPort = parseInt(connectionSettings.serverPort, 10);

  const settingsToSave = {
    connection: {
      type: connectionSettings.type?.toLowerCase() || DEFAULT_SETTINGS.connection.type,
      ip: connectionSettings.ipAddress || DEFAULT_SETTINGS.connection.ip,
      port: Number.isFinite(parsedPort) ? parsedPort : DEFAULT_SETTINGS.connection.port,
      serverPort: Number.isFinite(parsedServerPort) ? parsedServerPort : DEFAULT_SETTINGS.connection.serverPort,
      usbPort: connectionSettings.usbPort || DEFAULT_SETTINGS.connection.usbPort,
      baudRate: Number.isFinite(parsedBaudRate) ? parsedBaudRate : DEFAULT_SETTINGS.connection.baudRate
    }
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
    log(`Failed to remove setting '${key}':`, error);
    throw error;
  }
}

export { SETTINGS_PATH, DEFAULT_SETTINGS };
