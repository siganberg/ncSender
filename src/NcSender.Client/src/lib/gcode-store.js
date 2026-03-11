// Lightweight IndexedDB wrapper for storing and retrieving large G-code files
// Stores G-code as a single blob for maximum performance

const DB_NAME = 'ncSender';
const DB_VERSION = 2; // Incremented to trigger schema change
const GCODE_STORE = 'gcodeFiles';
const DATA_ID = 'current';

let idbEnabled = typeof indexedDB !== 'undefined' && !!indexedDB;

// Cache for split lines to avoid repeated splitting during virtual scroll
let cachedLines = null;
let cachedTimestamp = null;

export function isIDBEnabled() {
  return idbEnabled;
}

function openDB() {
  if (!idbEnabled) {
    return Promise.reject(new Error('IndexedDB not available'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      // Delete old stores if they exist
      if (db.objectStoreNames.contains('gcodeLines')) {
        db.deleteObjectStore('gcodeLines');
      }
      if (db.objectStoreNames.contains('gcodeMeta')) {
        db.deleteObjectStore('gcodeMeta');
      }

      // Create new single-object store
      if (!db.objectStoreNames.contains(GCODE_STORE)) {
        db.createObjectStore(GCODE_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      idbEnabled = false;
      reject(request.error);
    };
  });
}

export async function clearGCodeIDB() {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();

  // Invalidate cache when clearing
  cachedLines = null;
  cachedTimestamp = null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readwrite');
    tx.objectStore(GCODE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveGCodeToIDB(filename, content) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();

  // Split into lines and count (but keep content as single string)
  const lines = content.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  const lineCount = lines.length;
  const cleanContent = lines.join('\n');

  // Invalidate cache when saving new file
  cachedLines = null;
  cachedTimestamp = null;

  // Store as single object for efficient retrieval
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readwrite');
    const store = tx.objectStore(GCODE_STORE);

    const timestamp = new Date().toISOString();
    const data = {
      id: DATA_ID,
      filename: filename || '',
      content: cleanContent,
      lineCount: lineCount,
      timestamp: timestamp
    };

    store.put(data);

    tx.oncomplete = () => resolve({ lineCount });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLineCountFromIDB() {
  if (!idbEnabled) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readonly');
    const req = tx.objectStore(GCODE_STORE).get(DATA_ID);
    req.onsuccess = () => {
      resolve((req.result && req.result.lineCount) || 0);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getFilenameFromIDB() {
  if (!idbEnabled) return '';
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readonly');
    const req = tx.objectStore(GCODE_STORE).get(DATA_ID);
    req.onsuccess = () => {
      resolve((req.result && req.result.filename) || '');
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLinesRangeFromIDB(start, end) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  if (start > end) return [];

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readonly');
    const req = tx.objectStore(GCODE_STORE).get(DATA_ID);
    req.onsuccess = () => {
      const data = req.result;
      if (!data || !data.content) {
        resolve([]);
        return;
      }

      // Use cached split if available and timestamp matches
      if (cachedLines && cachedTimestamp === data.timestamp) {
        const result = cachedLines.slice(start - 1, end);
        resolve(result);
        return;
      }

      // Split and cache for subsequent calls
      cachedLines = data.content.split('\n');
      cachedTimestamp = data.timestamp;

      const result = cachedLines.slice(start - 1, end);
      resolve(result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getGCodeFromIDB() {
  if (!idbEnabled) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GCODE_STORE], 'readonly');
    const req = tx.objectStore(GCODE_STORE).get(DATA_ID);
    req.onsuccess = () => {
      const data = req.result;
      if (!data) {
        resolve(null);
        return;
      }
      resolve({
        filename: data.filename,
        content: data.content
      });
    };
    req.onerror = () => reject(req.error);
  });
}
