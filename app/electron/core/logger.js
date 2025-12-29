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

import fs from 'node:fs';
import path from 'node:path';
import { getUserDataDir } from '../utils/paths.js';

const LOGS_DIR = path.join(getUserDataDir(), 'logs');
const MAX_LOG_DAYS = 30;

let currentLogDate = null;
let currentLogStream = null;
let isInitialized = false;

/**
 * Get the log filename for a given date
 * @param {Date} date
 * @returns {string}
 */
function getLogFilename(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.log`;
}

/**
 * Get the date string for comparison (YYYY-MM-DD)
 * @param {Date} date
 * @returns {string}
 */
function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Initialize the logger - create logs directory if needed
 */
function initLogger() {
  if (isInitialized) return;

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    isInitialized = true;

    // Clean up old logs on startup
    cleanupOldLogs();
  } catch (error) {
    console.error('[Logger] Failed to initialize:', error.message);
  }
}

/**
 * Get or create the write stream for today's log file
 * @returns {fs.WriteStream|null}
 */
function getLogStream() {
  const today = getDateString(new Date());

  // If we have a stream for today, use it
  if (currentLogStream && currentLogDate === today) {
    return currentLogStream;
  }

  // Close previous stream if exists
  if (currentLogStream) {
    try {
      currentLogStream.end();
    } catch (e) {
      // Ignore close errors
    }
  }

  // Create new stream for today
  try {
    initLogger();
    const logPath = path.join(LOGS_DIR, getLogFilename(new Date()));
    currentLogStream = fs.createWriteStream(logPath, { flags: 'a' });
    currentLogDate = today;

    currentLogStream.on('error', (err) => {
      console.error('[Logger] Write stream error:', err.message);
      currentLogStream = null;
    });

    return currentLogStream;
  } catch (error) {
    console.error('[Logger] Failed to create log stream:', error.message);
    return null;
  }
}

/**
 * Clean up log files older than MAX_LOG_DAYS
 */
function cleanupOldLogs() {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;

    const files = fs.readdirSync(LOGS_DIR);
    const now = Date.now();
    const maxAge = MAX_LOG_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.log')) continue;

      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtime.getTime();

      if (age > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[Logger] Cleaned up old log file: ${file}`);
      }
    }
  } catch (error) {
    console.error('[Logger] Failed to cleanup old logs:', error.message);
  }
}

/**
 * Format a single argument to string (for file logging)
 * @param {any} arg
 * @returns {string}
 */
function formatArg(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (arg instanceof Error) {
    return arg.stack || arg.message || String(arg);
  }
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, null, 2);
    } catch (e) {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * Format log arguments to string (for file logging)
 * @param {any[]} args
 * @returns {string}
 */
function formatArgsForFile(args) {
  return args.map(formatArg).join(' ');
}

/**
 * Write a log entry
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} prefix - Module prefix
 * @param {any[]} args - Log arguments
 */
function writeLog(level, prefix, args) {
  const timestamp = new Date().toISOString();
  const logPrefix = `[${timestamp}] [${level}]${prefix ? ` [${prefix}]` : ''}`;

  // Write to console with native object formatting (colors and pretty-print)
  const consoleMethod = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleMethod(logPrefix, ...args);

  // Write to file with formatted strings
  const fileMessage = formatArgsForFile(args);
  const logLine = `${logPrefix} ${fileMessage}\n`;

  const stream = getLogStream();
  if (stream) {
    stream.write(logLine);
  }
}

/**
 * Create a logger instance with a module prefix
 * @param {string} moduleName - Name of the module for log prefix
 * @returns {Object} Logger with info, warn, error, debug methods
 */
export function createLogger(moduleName) {
  return {
    info: (...args) => writeLog('INFO', moduleName, args),
    warn: (...args) => writeLog('WARN', moduleName, args),
    error: (...args) => writeLog('ERROR', moduleName, args),
    debug: (...args) => writeLog('DEBUG', moduleName, args),
    // Shorthand log method (same as info)
    log: (...args) => writeLog('INFO', moduleName, args)
  };
}

/**
 * Default logger without module prefix
 */
export const logger = createLogger('');

/**
 * Get the path to the logs directory
 * @returns {string}
 */
export function getLogsDir() {
  return LOGS_DIR;
}

/**
 * Close the logger (for graceful shutdown)
 */
export function closeLogger() {
  if (currentLogStream) {
    try {
      currentLogStream.end();
      currentLogStream = null;
    } catch (e) {
      // Ignore close errors
    }
  }
}
