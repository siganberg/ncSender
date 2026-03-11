// IndexedDB storage for terminal console history with append + range reads

const DB_NAME = 'ncSenderTerm';
const DB_VERSION = 1;
const LINES_STORE = 'terminalLines';
const META_STORE = 'terminalMeta';

let idbEnabled = typeof indexedDB !== 'undefined' && !!indexedDB;

export function isTerminalIDBEnabled() {
  return idbEnabled;
}

function openDB() {
  if (!idbEnabled) return Promise.reject(new Error('IndexedDB not available'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LINES_STORE)) {
        const store = db.createObjectStore(LINES_STORE, { keyPath: 'seq', autoIncrement: true });
        try {
          store.createIndex('byId', 'id', { unique: true });
        } catch {}
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      idbEnabled = false;
      reject(req.error);
    };
  });
}

export async function clearTerminalIDB() {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE, META_STORE], 'readwrite');
    tx.objectStore(LINES_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Append a new console line. Returns assigned seq key.
export async function appendTerminalLineToIDB(line) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE, META_STORE], 'readwrite');
    const store = tx.objectStore(LINES_STORE);
    const metaStore = tx.objectStore(META_STORE);
    const addReq = store.add({
      // seq auto-increment
      id: line.id,
      level: line.level,
      message: line.message,
      timestamp: line.timestamp,
      status: line.status,
      type: line.type,
      sourceId: line.sourceId,
      meta: line.meta || null
    });
    addReq.onsuccess = () => {
      const seq = addReq.result;
      // Update seq bounds
      const firstReq = metaStore.get('firstSeq');
      firstReq.onsuccess = () => {
        const firstSeq = firstReq.result?.value;
        if (firstSeq === undefined) {
          metaStore.put({ key: 'firstSeq', value: seq });
        }
        metaStore.put({ key: 'lastSeq', value: seq });
      };
      firstReq.onerror = () => {
        // best-effort
        metaStore.put({ key: 'lastSeq', value: seq });
      };
      resolve(seq);
    };
    addReq.onerror = () => reject(addReq.error);
  });
}

// Update an existing console line by its logical id (e.g., command id)
export async function updateTerminalLineByIdInIDB(id, patch) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE], 'readwrite');
    const store = tx.objectStore(LINES_STORE);
    const idx = store.index('byId');
    const getReq = idx.getKey(id);
    getReq.onsuccess = () => {
      const key = getReq.result;
      if (key === undefined) {
        resolve(false);
        return;
      }
      const getRec = store.get(key);
      getRec.onsuccess = () => {
        const rec = getRec.result;
        const updated = { ...rec, ...patch };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
      };
      getRec.onerror = () => reject(getRec.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getTerminalCountFromIDB() {
  if (!idbEnabled) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE], 'readonly');
    const store = tx.objectStore(LINES_STORE);
    const countReq = store.count();
    countReq.onsuccess = () => resolve(countReq.result || 0);
    countReq.onerror = () => reject(countReq.error);
  });
}

// Return array of line objects for seq range [start, end] inclusive
export async function getTerminalLinesRangeFromIDB(start, end) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  if (start > end) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LINES_STORE], 'readonly');
    const store = tx.objectStore(LINES_STORE);
    const range = IDBKeyRange.bound(start, end);
    const out = [];
    const cursorReq = store.openCursor(range);
    cursorReq.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) {
        out.push({ seq: cursor.key, ...cursor.value });
        cursor.continue();
      } else {
        out.sort((a, b) => a.seq - b.seq);
        resolve(out);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function getTerminalSeqBoundsFromIDB() {
  if (!idbEnabled) return { firstSeq: undefined, lastSeq: undefined };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE], 'readonly');
    const metaStore = tx.objectStore(META_STORE);
    const firstReq = metaStore.get('firstSeq');
    const lastReq = metaStore.get('lastSeq');
    let firstSeq, lastSeq;
    firstReq.onsuccess = () => { firstSeq = firstReq.result?.value; };
    lastReq.onsuccess = () => { lastSeq = lastReq.result?.value; };
    tx.oncomplete = () => resolve({ firstSeq, lastSeq });
    tx.onerror = () => reject(tx.error);
  });
}

// Fetch by 0-based index window (inclusive start, exclusive end)
export async function getTerminalLinesWindowFromIDB(startIndex, endIndex) {
  if (!idbEnabled) throw new Error('IndexedDB disabled');
  if (endIndex <= startIndex) return [];
  const { firstSeq } = await getTerminalSeqBoundsFromIDB();
  if (firstSeq === undefined) return [];
  const startSeq = firstSeq + startIndex;
  const endSeq = firstSeq + endIndex - 1;
  return getTerminalLinesRangeFromIDB(startSeq, endSeq);
}
