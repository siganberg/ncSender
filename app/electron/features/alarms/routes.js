import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
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

const ALARMS_FILE_PATH = path.join(getUserDataDir(), 'alarms.json');

// Read alarms from file
function readAlarmsFile() {
  try {
    if (!fs.existsSync(ALARMS_FILE_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(ALARMS_FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    log('Failed to read alarms file:', error.message);
    return null;
  }
}

// Write alarms to file
function writeAlarmsFile(alarms) {
  try {
    const alarmsDir = path.dirname(ALARMS_FILE_PATH);
    if (!fs.existsSync(alarmsDir)) {
      fs.mkdirSync(alarmsDir, { recursive: true });
    }
    fs.writeFileSync(ALARMS_FILE_PATH, JSON.stringify(alarms, null, 2), 'utf8');
    log('Alarm codes saved to file');
  } catch (error) {
    log('Failed to write alarms file:', error.message);
    throw error;
  }
}

// Fetch alarm codes from controller using $EA command
async function fetchAlarmCodesFromController(cncController) {
  if (!cncController || !cncController.isConnected) {
    throw new Error('CNC controller not connected');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for alarm codes from controller'));
    }, 5000);

    const alarmCodes = {};
    const dataListener = (data) => {
      // Parse format: [ALARMCODE:1||Description text]
      const match = data.match(/\[ALARMCODE:(\d+)\|\|(.*?)\]/);
      if (match) {
        const code = parseInt(match[1]);
        const description = match[2].trim();
        alarmCodes[code] = description;
      }
    };

    // Listen for response
    cncController.on('data', dataListener);

    // Send $EA command
    cncController.sendCommand('$EA', { meta: { sourceId: 'no-broadcast' } }).then(() => {
      // Wait a bit for all responses
      setTimeout(() => {
        clearTimeout(timeout);
        cncController.off('data', dataListener);
        resolve(alarmCodes);
      }, 1000);
    }).catch((error) => {
      clearTimeout(timeout);
      cncController.off('data', dataListener);
      reject(error);
    });
  });
}

// Fetch and save alarm codes from controller
export async function fetchAndSaveAlarmCodes(cncController) {
  // Check if alarms.json already exists
  const existingAlarms = readAlarmsFile();
  if (existingAlarms) {
    log('Alarm codes already cached in file, skipping fetch');
    return existingAlarms;
  }

  try {
    log('Fetching alarm codes from controller...');
    const alarmCodes = await fetchAlarmCodesFromController(cncController);
    writeAlarmsFile(alarmCodes);
    log('Alarm codes fetched and saved successfully');
    return alarmCodes;
  } catch (error) {
    log('Failed to fetch alarm codes from controller:', error.message);
    throw error;
  }
}

export function createAlarmRoutes(serverState, cncController) {
  const router = Router();

  // Get alarm description by ID
  router.get('/alarm/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid alarm ID' });
      }

      const alarms = readAlarmsFile();
      if (!alarms) {
        return res.status(404).json({ error: 'Alarm codes not available. Controller may not be connected.' });
      }

      const description = alarms[id] || 'Unknown Alarm';
      res.json({ id, description });
    } catch (error) {
      log('Error getting alarm description:', error);
      res.status(500).json({ error: 'Failed to get alarm description' });
    }
  });

  return router;
}
