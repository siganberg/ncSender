import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUserDataDir } from '../utils/paths.js';
import { FIRMWARE_DATA_TYPES, DATA_TYPE_NAMES } from '../constants/firmware-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to firmware.json storage (same location as settings.json)
const FIRMWARE_FILE_PATH = path.join(getUserDataDir(), 'firmware.json');

/**
 * Parse $EG (enumerate setting groups) response
 * Format: [SETTINGGROUP:<id>|<parent id>|<name>]
 */
function parseSettingGroups(response) {
  const groups = {};
  const lines = response.split('\n').filter(line => line.trim());

  for (const line of lines) {
    if (line.startsWith('[SETTINGGROUP:')) {
      // Extract content between brackets
      const content = line.substring(14, line.length - 1); // Remove [SETTINGGROUP: and ]
      const parts = content.split('|');

      if (parts.length >= 3) {
        const [id, parentId, name] = parts;
        groups[id] = {
          id: parseInt(id),
          parentId: parseInt(parentId),
          name: name.trim()
        };
      }
    }
  }

  return groups;
}

/**
 * Parse $ES (enumerate settings) response
 * Format: [SETTING:<id>|<group id>|<name>|{<unit>}|<data type>|{<format>}|{<min>}|{<max>}]
 *
 * Data types are defined in ../constants/firmware-types.js:
 * 0 = int8, 1 = uint8, 2 = int16, 3 = uint16, 4 = int32, 5 = uint32
 * 6 = float, 7 = bitfield, 8 = string, 9 = mask (bitmask)
 */
function parseSettings(response) {
  const settings = {};
  const lines = response.split('\n').filter(line => line.trim());

  for (const line of lines) {
    if (line.startsWith('[SETTING:')) {
      // Extract content between brackets
      const content = line.substring(9, line.length - 1); // Remove [SETTING: and ]
      const parts = content.split('|');

      if (parts.length >= 5) {
        const id = parts[0];
        settings[id] = {
          id: parseInt(id),
          groupId: parts[1] ? parseInt(parts[1]) : null,
          name: parts[2] || '',
          unit: parts[3] || null,
          dataType: parseInt(parts[4]) || 0,
          format: parts[5] || null,
          min: parts[6] || null,
          max: parts[7] || null
        };
      }
    }
  }

  return settings;
}

/**
 * Parse $ESH (enumerate settings in HAL format) response
 * Tab-separated format with additional details
 */
function parseSettingsHAL(response) {
  const settings = {};
  const lines = response.split('\n').filter(line => line.trim() && line !== 'ok');

  for (const line of lines) {
    const parts = line.split('\t');

    if (parts.length > 0) {
      const id = parts[0];
      if (id && !isNaN(parseInt(id))) {
        settings[id] = {
          id: parseInt(id),
          details: parts.slice(1) // Store remaining tab-separated details
        };
      }
    }
  }

  return settings;
}

/**
 * Parse $I (build info) response to extract firmware version
 * Format: [VER:1.1f.20250407:]
 */
function parseFirmwareVersion(response) {
  const lines = response.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const match = line.match(/^\[VER:([^\]]+)\]$/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Parse $$ (current settings values) response
 * Format: $<id>=<value>
 */
function parseCurrentValues(response) {
  const values = {};
  const lines = response.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Match lines like "$0=10" or "$1=25.5"
    const match = line.match(/^\$(\d+)=(.+)$/);
    if (match) {
      const id = match[1];
      const value = match[2];
      values[id] = value;
    }
  }

  return values;
}

/**
 * Merge all command responses into unified firmware data structure
 */
function mergeFirmwareData(groups, settings, halSettings, currentValues = {}) {
  const merged = {};

  // Start with settings as the base (using setting ID as primary key)
  for (const [id, setting] of Object.entries(settings)) {
    merged[id] = { ...setting };

    // Add current value if available
    if (currentValues[id] !== undefined) {
      merged[id].value = currentValues[id];
    }

    // Add HAL details if available
    if (halSettings[id]) {
      merged[id].halDetails = halSettings[id].details;
    }

    // Add group information
    if (setting.groupId && groups[setting.groupId]) {
      merged[id].group = groups[setting.groupId];
    }
  }

  // Add metadata
  const firmwareData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    groups,
    settings: merged
  };

  return firmwareData;
}

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
  const dataDir = path.dirname(FIRMWARE_FILE_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * Query firmware settings structure from CNC controller
 * Sends $EG, $ES, $ESH commands and collects responses
 */
async function queryFirmwareStructure(cncController) {
  const TIMEOUT_MS = 10000; // 10 second timeout
  const commands = ['$EG', '$ES', '$ESH'];
  const responses = {
    $EG: '',
    $ES: '',
    $ESH: ''
  };
  let currentCommand = null;
  const completedCommands = new Set();

  return new Promise((resolve, reject) => {
    let timeoutId;
    let dataHandler;
    let ackHandler;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (dataHandler) cncController.off('data', dataHandler);
      if (ackHandler) cncController.off('command-ack', ackHandler);
    };

    const checkCompletion = () => {
      if (completedCommands.size === commands.length) {
        cleanup();

        // Parse responses
        const groups = parseSettingGroups(responses.$EG);
        const settings = parseSettings(responses.$ES);
        const halSettings = parseSettingsHAL(responses.$ESH);

        resolve({ groups, settings, halSettings });
      }
    };

    // Timeout handler
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for firmware query responses. Completed: ${completedCommands.size}/${commands.length}`));
    }, TIMEOUT_MS);

    // Listen for data events (accumulate responses for current command)
    dataHandler = (data) => {
      if (currentCommand && typeof data === 'string') {
        responses[currentCommand] += data + '\n';
      }
    };

    // Listen for command acknowledgements (completion)
    ackHandler = (event) => {
      const cmd = event.command;
      if (commands.includes(cmd)) {
        completedCommands.add(cmd);
        currentCommand = null; // Clear current command
        checkCompletion();
      }
    };

    cncController.on('data', dataHandler);
    cncController.on('command-ack', ackHandler);

    // Send commands sequentially to track which command's data we're receiving
    const sendNext = async (index) => {
      if (index >= commands.length) return;

      const cmd = commands[index];
      currentCommand = cmd;

      try {
        await cncController.sendCommand(cmd, {
          commandId: `${cmd}-${Date.now()}`,
          displayCommand: cmd,
          meta: { sourceId: 'no-broadcast' }
        });
        // Wait a bit before sending next command
        setTimeout(() => sendNext(index + 1), 100);
      } catch (error) {
        cleanup();
        reject(new Error(`Failed to send command ${cmd}: ${error.message}`));
      }
    };

    sendNext(0);
  });
}

/**
 * Query current setting values from CNC controller
 * Sends $$ command and collects responses
 */
async function queryCurrentValues(cncController) {
  const TIMEOUT_MS = 5000; // 5 second timeout
  let response = '';

  return new Promise((resolve, reject) => {
    let timeoutId;
    let dataHandler;
    let ackHandler;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (dataHandler) cncController.off('data', dataHandler);
      if (ackHandler) cncController.off('command-ack', ackHandler);
    };

    // Timeout handler
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for $$ response'));
    }, TIMEOUT_MS);

    // Listen for data events
    dataHandler = (data) => {
      if (typeof data === 'string') {
        response += data + '\n';
      }
    };

    // Listen for command acknowledgement
    ackHandler = (event) => {
      if (event.command === '$$') {
        cleanup();
        const values = parseCurrentValues(response);
        resolve(values);
      }
    };

    cncController.on('data', dataHandler);
    cncController.on('command-ack', ackHandler);

    // Send $$ command
    cncController.sendCommand('$$', {
      commandId: `$$-${Date.now()}`,
      displayCommand: '$$',
      meta: { sourceId: 'no-broadcast' }
    }).catch((error) => {
      cleanup();
      reject(new Error(`Failed to send $$ command: ${error.message}`));
    });
  });
}

/**
 * Check and initialize firmware structure on connection
 * Called when CNC controller connects
 */
export async function initializeFirmwareOnConnection(cncController) {
  if (!cncController || !cncController.isConnected) {
    console.log('Cannot initialize firmware: controller not connected');
    return;
  }

  try {
    // Query $I to get firmware version
    console.log('Querying firmware version with $I...');
    const versionResponse = await querySingleCommand(cncController, '$I');
    const currentVersion = parseFirmwareVersion(versionResponse);

    if (!currentVersion) {
      console.error('Failed to parse firmware version from $I response');
      return;
    }

    console.log('Firmware version:', currentVersion);

    // Check if firmware.json exists and version matches
    let needsStructureUpdate = false;
    try {
      const data = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
      const existingData = JSON.parse(data);

      if (existingData.firmwareVersion !== currentVersion) {
        console.log(`Firmware version mismatch: ${existingData.firmwareVersion} -> ${currentVersion}`);
        needsStructureUpdate = true;
      } else {
        console.log('Firmware version matches, skipping structure query');
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('firmware.json not found, initializing...');
        needsStructureUpdate = true;
      } else {
        throw error;
      }
    }

    // Query firmware structure if needed
    if (needsStructureUpdate) {
      console.log('Querying firmware structure ($EG, $ES, $ESH)...');
      const { groups, settings, halSettings } = await queryFirmwareStructure(cncController);

      // Build firmware data structure (without current values)
      const firmwareData = {
        version: '1.0',
        firmwareVersion: currentVersion,
        timestamp: new Date().toISOString(),
        groups,
        settings: {}
      };

      // Merge structure data
      for (const [id, setting] of Object.entries(settings)) {
        firmwareData.settings[id] = { ...setting };

        if (halSettings[id]) {
          firmwareData.settings[id].halDetails = halSettings[id].details;
        }

        if (setting.groupId && groups[setting.groupId]) {
          firmwareData.settings[id].group = groups[setting.groupId];
        }
      }

      // Save to file
      await ensureDataDirectory();
      await fs.writeFile(FIRMWARE_FILE_PATH, JSON.stringify(firmwareData, null, 2), 'utf8');
      console.log('Firmware structure saved to firmware.json');
    }

    // Always refresh current values on connection using $$ and persist to firmware.json
    try {
      console.log('Refreshing firmware values with $$ on connection...');
      const currentValues = await queryCurrentValues(cncController);

      // Load existing file (created above or previously present)
      let firmwareData;
      try {
        const text = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
        firmwareData = JSON.parse(text);
      } catch {
        // If for some reason file is missing, construct minimal structure
        firmwareData = { version: '1.0', firmwareVersion: currentVersion, timestamp: new Date().toISOString(), groups: {}, settings: {} };
      }

      for (const [id, value] of Object.entries(currentValues)) {
        if (!firmwareData.settings[id]) {
          firmwareData.settings[id] = { id: parseInt(id, 10) };
        }
        firmwareData.settings[id].value = value;
      }
      firmwareData.timestamp = new Date().toISOString();

      await ensureDataDirectory();
      await fs.writeFile(FIRMWARE_FILE_PATH, JSON.stringify(firmwareData, null, 2), 'utf8');
      console.log('Firmware values refreshed from $$ and saved');
    } catch (error) {
      console.error('Failed to refresh firmware values on connection:', error?.message || error);
    }
  } catch (error) {
    console.error('Error initializing firmware on connection:', error);
  }
}

/**
 * Query single command and return response
 */
async function querySingleCommand(cncController, command) {
  const TIMEOUT_MS = 5000;
  let response = '';

  return new Promise((resolve, reject) => {
    let timeoutId;
    let dataHandler;
    let ackHandler;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (dataHandler) cncController.off('data', dataHandler);
      if (ackHandler) cncController.off('command-ack', ackHandler);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${command} response`));
    }, TIMEOUT_MS);

    dataHandler = (data) => {
      if (typeof data === 'string') {
        response += data + '\n';
      }
    };

    ackHandler = (event) => {
      if (event.command === command) {
        cleanup();
        resolve(response);
      }
    };

    cncController.on('data', dataHandler);
    cncController.on('command-ack', ackHandler);

    cncController.sendCommand(command, {
      commandId: `${command}-${Date.now()}`,
      displayCommand: command,
      meta: { sourceId: 'no-broadcast' }
    }).catch((error) => {
      cleanup();
      reject(new Error(`Failed to send ${command}: ${error.message}`));
    });
  });
}

export function createFirmwareRoutes(cncController) {
  const router = express.Router();

  // GET /api/firmware - Return cached firmware settings from firmware.json (no controller calls)
  router.get('/', async (_req, res) => {
    try {
      const data = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
      const firmwareData = JSON.parse(data);
      res.json(firmwareData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Firmware data not initialized. Connect to the CNC controller to populate values.' });
      } else {
        console.error('Error reading firmware data:', error);
        res.status(500).json({ error: 'Failed to read firmware data' });
      }
    }
  });

  // No per-setting route; clients should read all from GET /api/firmware

  return router;
}
