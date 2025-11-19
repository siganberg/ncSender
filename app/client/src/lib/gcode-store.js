// Lightweight IndexedDB wrapper for storing and retrieving large G-code files
// Stores each line as an individual record for efficient range reads

const DB_NAME = 'ncSender';
const DB_VERSION = 1;
const LINES_STORE = 'gcodeLines';
const META_STORE = 'gcodeMeta';

let idbEnabled = typeof indexedDB !== 'undefined' && !!indexedDB;

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
      if (!db.objectStoreNames.contains(LINES_STORE)) {
        db.createObjectStore(LINES_STORE, { keyPath: 'line' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
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
  await Promise.all([
    new Promise((resolve, reject) => {
      const tx = db.transaction([LINES_STORE, META_STORE], 'readwrite');
      tx.objectStore(LINES_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })
  ]);
}

export async function saveGCodeToIDB(filename, content) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();

  // Split into lines and remove trailing empty lines
  const lines = content.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  const lineCount = lines.length;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE, META_STORE], 'readwrite');
    const linesStore = tx.objectStore(LINES_STORE);
    const metaStore = tx.objectStore(META_STORE);

    // Clear previous content first
    linesStore.clear();
    metaStore.clear();

    // Write meta
    metaStore.put({ key: 'filename', value: filename || '' });
    metaStore.put({ key: 'lineCount', value: lineCount });
    metaStore.put({ key: 'timestamp', value: new Date().toISOString() });

    // Batch insert lines
    for (let i = 0; i < lineCount; i++) {
      linesStore.put({ line: i + 1, text: lines[i] });
    }

    tx.oncomplete = () => resolve({ lineCount });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLineCountFromIDB() {
  if (!idbEnabled) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE], 'readonly');
    const req = tx.objectStore(META_STORE).get('lineCount');
    req.onsuccess = () => {
      resolve((req.result && req.result.value) || 0);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getFilenameFromIDB() {
  if (!idbEnabled) return '';
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE], 'readonly');
    const req = tx.objectStore(META_STORE).get('filename');
    req.onsuccess = () => {
      resolve((req.result && req.result.value) || '');
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLinesRangeFromIDB(start, end) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  if (start > end) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE], 'readonly');
    const store = tx.objectStore(LINES_STORE);
    const range = IDBKeyRange.bound(start, end);
    const lines = [];

    store.openCursor(range).onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        lines.push({ line: cursor.key, text: cursor.value.text });
        cursor.continue();
      } else {
        // Ensure results are sorted by line and dense
        lines.sort((a, b) => a.line - b.line);
        const result = [];
        for (let i = start; i <= end; i++) {
          const found = lines.find((l) => l.line === i);
          result.push(found ? found.text : '');
        }
        resolve(result);
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getGCodeFromIDB() {
  if (!idbEnabled) return null;
  try {
    const lineCount = await getLineCountFromIDB();
    const filename = await getFilenameFromIDB();
    if (lineCount === 0) return null;

    const lines = await getLinesRangeFromIDB(1, lineCount);
    const content = lines.join('\n');
    return { filename, content };
  } catch (error) {
    console.error('Failed to retrieve G-code from IndexedDB:', error);
    return null;
  }
}
