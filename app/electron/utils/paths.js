import os from 'node:os';
import path from 'node:path';

/**
 * Get the user data directory based on platform
 * @returns {string} Path to user data directory
 */
export function getUserDataDir() {
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

/**
 * Validates and normalizes a path to prevent traversal attacks
 * @param {string} baseDir - The root directory (e.g., gcode-files)
 * @param {string} relativePath - User-provided relative path
 * @returns {string} Absolute safe path
 * @throws {Error} If path traversal detected
 */
export function getSafePath(baseDir, relativePath) {
  if (!relativePath) {
    return baseDir;
  }

  const normalized = path.normalize(relativePath);

  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path: traversal not allowed');
  }

  const fullPath = path.join(baseDir, normalized);
  const resolvedBase = path.resolve(baseDir);
  const resolvedFull = path.resolve(fullPath);

  if (!resolvedFull.startsWith(resolvedBase + path.sep) && resolvedFull !== resolvedBase) {
    throw new Error('Invalid path: outside base directory');
  }

  return fullPath;
}

/**
 * Checks if a name is valid for files/folders (no path separators or traversal)
 * @param {string} name - The file or folder name to validate
 * @returns {boolean} True if valid
 */
export function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  if (name.length > 255) return false;
  return true;
}

/**
 * Get the parent directory from a relative path
 * @param {string} relativePath - Relative path
 * @returns {string} Parent path or empty string for root
 */
export function getParentPath(relativePath) {
  if (!relativePath) return '';
  const normalized = path.normalize(relativePath);
  const parent = path.dirname(normalized);
  return parent === '.' ? '' : parent;
}

/**
 * Generate a simple hash ID for a path
 * @param {string} itemPath - The path to hash
 * @returns {string} A hash string
 */
export function generatePathId(itemPath) {
  let hash = 0;
  const str = itemPath || 'root';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
