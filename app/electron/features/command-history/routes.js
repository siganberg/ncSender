import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('CommandHistory');

// Get the user data directory path
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

const getDataDir = () => {
  return getUserDataDir();
};

const getHistoryFilePath = () => {
  return path.join(getDataDir(), 'command-history.json');
};

// Load command history from file
const loadCommandHistory = async () => {
  try {
    const historyPath = getHistoryFilePath();
    const data = await fs.readFile(historyPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist or is invalid, return empty array
    return [];
  }
};

// Save command history to file
const saveCommandHistory = async (history) => {
  try {
    const dataDir = getDataDir();
    const historyPath = getHistoryFilePath();

    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Save history to file
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    log('Error saving command history:', error);
  }
};

export function createCommandHistoryRoutes(initialCommandHistory, MAX_HISTORY_SIZE, broadcast) {
  const router = Router();

  // Load persistent history on startup
  let commandHistory = initialCommandHistory;
  loadCommandHistory().then(persistentHistory => {
    commandHistory.splice(0, commandHistory.length, ...persistentHistory);
    log('Loaded', persistentHistory.length, 'commands from persistent history');
  }).catch(error => {
    log('Failed to load persistent history:', error.message);
  });

  // Get command history
  router.get('/', (req, res) => {
    try {
      res.json(commandHistory);
    } catch (error) {
      log('Error getting command history:', error);
      res.status(500).json({ error: 'Failed to get command history' });
    }
  });

  // Add command to history
  router.post('/', async (req, res) => {
    const { command } = req.body;
    try {
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: 'Command is required and must be a string' });
      }

      // Don't add duplicate consecutive commands
      if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== command) {
        commandHistory.push(command);

        // Keep only the last MAX_HISTORY_SIZE commands
        if (commandHistory.length > MAX_HISTORY_SIZE) {
          commandHistory.splice(0, commandHistory.length - MAX_HISTORY_SIZE);
        }

        // Save to persistent storage
        await saveCommandHistory(commandHistory);

        if (typeof broadcast === 'function') {
          broadcast('command-history-appended', {
            command,
            historySize: commandHistory.length
          });
        }
      }

      res.json({ success: true, historySize: commandHistory.length, command });
    } catch (error) {
      log('Error adding command to history:', error);
      res.status(500).json({ error: 'Failed to add command to history' });
    }
  });

  return router;
}
