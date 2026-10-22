// The Terminal used to copy every line into IndexedDB ("ncSenderTerm"),
// opening a new database connection per line and per status update, and
// nothing ever read it back. That cost made a pendant jog stream with Show
// G-Code on fall seconds behind, DRO included. The copy is gone; this only
// deletes the database older versions left behind.
export function dropTerminalIDB() {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) indexedDB.deleteDatabase('ncSenderTerm');
  } catch {
    // Nothing to clean up, or storage is unavailable.
  }
}
