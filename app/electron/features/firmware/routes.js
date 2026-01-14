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

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUserDataDir } from '../../utils/paths.js';
import { FIRMWARE_DATA_TYPES, DATA_TYPE_NAMES } from '../../constants/firmware-types.js';
import { SerialPort } from 'serialport';
import FirmwareFlasher from './flashing/DFUFlasher.js';
import { createLogger } from '../../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { log, error: logError } = createLogger('Firmware');

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
 * Data types are defined in ../../constants/firmware-types.js:
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
          meta: { sourceId: 'system' }
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
      meta: { sourceId: 'system' }
    }).catch((error) => {
      cleanup();
      reject(new Error(`Failed to send $$ command: ${error.message}`));
    });
  });
}

// Guard to prevent concurrent firmware initializations
let isInitializing = false;

/**
 * Check and initialize firmware structure on connection
 * Called when CNC controller connects
 * @param {object} cncController - The CNC controller instance
 * @param {boolean} force - Force full refresh, bypassing version check
 */
export async function initializeFirmwareOnConnection(cncController, force = false) {
  log(`initializeFirmwareOnConnection called with force=${force}`);

  if (!cncController || !cncController.isConnected) {
    log('Cannot initialize firmware: controller not connected');
    return;
  }

  if (isInitializing) {
    log('Firmware initialization already in progress, skipping duplicate request');
    return;
  }

  isInitializing = true;
  log('Starting firmware initialization...');

  try {
    // Query $I to get firmware version
    log('Querying firmware version with $I...');
    const versionResponse = await querySingleCommand(cncController, '$I');
    const currentVersion = parseFirmwareVersion(versionResponse);

    if (!currentVersion) {
      log('Failed to parse firmware version from $I response');
      return;
    }

    log('Firmware version:', currentVersion);

    // Check if firmware.json exists and version matches
    let needsStructureUpdate = force; // Force refresh bypasses version check
    if (!force) {
      try {
        const data = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
        const existingData = JSON.parse(data);

        if (existingData.firmwareVersion !== currentVersion) {
          log(`Firmware version mismatch: ${existingData.firmwareVersion} -> ${currentVersion}`);
          needsStructureUpdate = true;
        } else {
          log('Firmware version matches, skipping structure query');
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          log('firmware.json not found, initializing...');
          needsStructureUpdate = true;
        } else {
          throw error;
        }
      }
    } else {
      log('Force refresh requested, will re-query all firmware data');
    }

    // Query firmware structure if needed
    if (needsStructureUpdate) {
      log('Querying firmware structure ($EG, $ES, $ESH)...');
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
      log('Firmware structure saved to firmware.json');
    }

    // Always refresh current values on connection using $$ and persist to firmware.json
    try {
      log('Refreshing firmware values with $$ on connection...');
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
          // Setting doesn't exist - create minimal entry
          firmwareData.settings[id] = { id: parseInt(id, 10), value };
        } else {
          // Setting exists - preserve ALL existing properties (name, unit, dataType, format, min, max, halDetails, group, etc.)
          // Only update the value property to avoid losing metadata
          firmwareData.settings[id] = {
            ...firmwareData.settings[id],
            value
          };
        }
      }
      firmwareData.timestamp = new Date().toISOString();

      await ensureDataDirectory();
      await fs.writeFile(FIRMWARE_FILE_PATH, JSON.stringify(firmwareData, null, 2), 'utf8');
      log('Firmware values refreshed from $$ and saved');
    } catch (error) {
      log('Failed to refresh firmware values on connection:', error?.message || error);
    }

    // Fetch alarm codes from controller
    try {
      const { fetchAndSaveAlarmCodes } = await import('../alarms/routes.js');
      await fetchAndSaveAlarmCodes(cncController);
    } catch (error) {
      log('Failed to fetch alarm codes on connection:', error?.message || error);
    }
  } catch (error) {
    log('Error initializing firmware on connection:', error);
  } finally {
    isInitializing = false;
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
      meta: { sourceId: 'system' }
    }).catch((error) => {
      cleanup();
      reject(new Error(`Failed to send ${command}: ${error.message}`));
    });
  });
}

const parseBooleanQuery = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

async function tryReadFirmwareFile() {
  const data = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
  return JSON.parse(data);
}

export function createFirmwareRoutes(cncController, broadcast, autoConnector) {
  const router = express.Router();

  // GET /api/firmware - Return cached firmware settings from firmware.json (no controller calls)
  router.get('/', async (req, res) => {
    const shouldRefresh = parseBooleanQuery(req.query?.refresh);
    const forceRefresh = parseBooleanQuery(req.query?.force);
    const canQueryController = Boolean(cncController?.isConnected);

    log(`GET /api/firmware - refresh=${shouldRefresh}, force=${forceRefresh}, canQuery=${canQueryController}`);

    if ((shouldRefresh || forceRefresh) && canQueryController) {
      try {
        log('Calling initializeFirmwareOnConnection with force=' + forceRefresh);
        await initializeFirmwareOnConnection(cncController, forceRefresh);
      } catch (error) {
        log('Failed to refresh firmware data via API request:', error?.message || error);
      }
    }

    try {
      const firmwareData = await tryReadFirmwareFile();
      res.json(firmwareData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (!canQueryController) {
          res.status(404).json({ error: 'Firmware data not initialized. Connect to the CNC controller to populate values.' });
          return;
        }

        try {
          await initializeFirmwareOnConnection(cncController);
          const firmwareData = await tryReadFirmwareFile();
          res.json(firmwareData);
        } catch (initError) {
          log('Failed to initialize firmware data after ENOENT:', initError?.message || initError);
          res.status(503).json({ error: 'Firmware data not yet available. Try again shortly.' });
        }
      } else {
        log('Error reading firmware data:', error);
        res.status(500).json({ error: 'Failed to read firmware data' });
      }
    }
  });

  // No per-setting route; clients should read all from GET /api/firmware

  // POST /api/firmware/flash - Flash firmware via DFU or Serial
  router.post('/flash', async (req, res) => {
    const { hex, port, isDFU } = req.body;

    if (!hex) {
      return res.status(400).json({ error: 'HEX file content is required' });
    }

    if (!port) {
      return res.status(400).json({ error: 'Port is required' });
    }

    const useDFU = isDFU || port === 'SLB_DFU';

    try {
      // For serial flashing, we need to disconnect and stop auto-reconnect
      if (!useDFU) {
        log('Stopping auto-connector and disconnecting controller for serial flash...');
        if (broadcast) {
          broadcast('flash:message', { type: 'info', content: 'Preparing to flash - stopping connections...' });
        }

        // Inhibit and stop auto-reconnect to prevent interference
        if (autoConnector) {
          autoConnector.inhibit(); // Prevent event handlers from restarting
          await autoConnector.stop();
          log('Auto-connector stopped and inhibited');
        }

        // Disconnect if currently connected
        const connection = cncController?.connection;
        const isConnected = cncController?.isConnected;
        log(`Controller state: isConnected=${isConnected}, hasConnection=${!!connection}, connectionType=${connection?.constructor?.name}`);

        if (connection || isConnected) {
          log('Disconnecting CNC controller...');

          // First call disconnect to stop polling and clean up state
          cncController.disconnect();
          log('Controller disconnect called');

          // Wait for the port to fully close
          if (connection && connection.isOpen) {
            log('Waiting for port to close...');
            await new Promise((resolve) => {
              const checkClosed = setInterval(() => {
                if (!connection.isOpen) {
                  clearInterval(checkClosed);
                  log('Port closed');
                  resolve();
                }
              }, 100);

              // Timeout after 3 seconds
              setTimeout(() => {
                clearInterval(checkClosed);
                log('Port close timeout');
                resolve();
              }, 3000);
            });
          }

          // Wait for OS to fully release the port
          log('Waiting for OS to release port...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          log('Port release wait complete');
        }

        if (broadcast) {
          broadcast('flash:message', { type: 'info', content: 'Controller disconnected, starting flash...' });
        }
      }

      // If not already in DFU mode, send $DFU command to trigger it
      if (!useDFU) {
        log(`Sending $DFU command to ${port} to trigger DFU bootloader mode...`);
        if (broadcast) {
          broadcast('flash:message', { type: 'info', content: `Sending $DFU command to ${port}...` });
        }

        try {
          // Open serial port and send $DFU command
          const serialPort = new SerialPort({ path: port, baudRate: 115200 });

          await new Promise((resolve, reject) => {
            serialPort.on('open', () => {
              log('Serial port opened for $DFU command');
              // Send $DFU command with newline
              serialPort.write('$DFU\n', (err) => {
                if (err) {
                  reject(new Error(`Failed to send $DFU command: ${err.message}`));
                  return;
                }
                log('$DFU command sent');

                // Wait a moment for command to be processed, then close port
                setTimeout(() => {
                  serialPort.close((closeErr) => {
                    if (closeErr) {
                      log('Warning: error closing serial port:', closeErr.message);
                    }
                    resolve();
                  });
                }, 500);
              });
            });

            serialPort.on('error', (err) => {
              reject(new Error(`Serial port error: ${err.message}`));
            });
          });

          // Wait for device to reboot into DFU mode
          log('Waiting for device to reboot into DFU mode...');
          if (broadcast) {
            broadcast('flash:message', { type: 'info', content: 'Waiting for device to enter DFU mode (2 seconds)...' });
          }
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (serialError) {
          log('Failed to send $DFU command:', serialError);
          if (broadcast) {
            broadcast('flash:error', { error: `Failed to trigger DFU mode: ${serialError.message}` });
          }

          // Restart auto-connector on failure
          if (autoConnector) {
            autoConnector.uninhibit();
            autoConnector.start();
          }

          return res.status(500).json({ error: `Failed to trigger DFU mode: ${serialError.message}` });
        }
      }

      // Now flash via DFU (either device was already in DFU or we just triggered it)
      log('Starting DFU firmware flash...');
      if (broadcast) {
        broadcast('flash:message', { type: 'info', content: 'Starting DFU flash...' });
      }

      const flasher = new FirmwareFlasher({ hex });

      // Set up event handlers to broadcast progress
      flasher.on('info', (message) => {
        log('Flash info:', message);
        if (broadcast) {
          broadcast('flash:message', { type: 'info', content: message });
        }
      });

      flasher.on('progress', (value, total) => {
        if (broadcast) {
          broadcast('flash:progress', { value, total });
        }
      });

      flasher.on('error', (error) => {
        log('Flash error:', error);
        if (broadcast) {
          broadcast('flash:error', { error });
        }
      });

      flasher.on('end', () => {
        log('Flash completed successfully');
        if (broadcast) {
          broadcast('flash:end', {});
        }
      });

      // Function to restart auto-connector after flashing
      const restartAutoConnector = () => {
        if (!useDFU && autoConnector) {
          log('Restarting auto-connector after flash...');
          // Delay to allow device to reboot
          setTimeout(() => {
            autoConnector.uninhibit(); // Allow auto-connect to work again
            autoConnector.start();
            log('Auto-connector uninhibited and restarted');
            if (broadcast) {
              broadcast('flash:message', { type: 'info', content: 'Auto-reconnect enabled. Device will reconnect shortly.' });
            }
          }, 3000);
        }
      };

      // Start flashing in background (don't block the response)
      flasher.flash()
        .then(() => {
          restartAutoConnector();
        })
        .catch((err) => {
          log('Flash process error:', err);
          if (broadcast) {
            broadcast('flash:error', { error: err.message });
          }
          // Still restart auto-connector on error
          restartAutoConnector();
        });

      res.json({ success: true, message: 'Flash process started', mode: useDFU ? 'DFU' : 'Serial' });
    } catch (error) {
      log('Failed to start flash process:', error);

      // Restart auto-connector if we stopped it
      if (!useDFU && autoConnector) {
        autoConnector.uninhibit();
        autoConnector.start();
      }

      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
