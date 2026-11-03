/**
 * backtestDb.js -- IndexedDB storage for backtest data
 *
 * Stores point-in-time bootstrap data (elements, teams, events) and
 * fixtures for each gameweek at deadline capture time. This enables
 * future backtesting: replaying historical data through updated scoring
 * pipelines and comparing against actual results.
 *
 * Uses IndexedDB instead of localStorage because each GW's data is
 * ~800KB-1MB, and localStorage has a ~5-10MB cap. IndexedDB handles
 * hundreds of MB comfortably.
 *
 * Storage format:
 *   Store: "backtestSnapshots"
 *   Key: gameweek number (e.g. 7)
 *   Value: {
 *     gw: number,
 *     capturedAt: ISO string,
 *     elements: [...],    // all ~700 players with cumulative stats at deadline
 *     teams: [...],       // team objects with strength ratings
 *     events: [...],      // gameweek metadata (deadlines, finished status)
 *     fixtures: [...]     // full fixture list as it existed at deadline
 *   }
 *
 * Note: element_stats, element_types, game_settings, and phases are
 * intentionally excluded for now. They rarely change between GWs and
 * don't affect the current scoring pipeline. Can be added later if needed.
 *
 * After a successful save, queueSync() is called to push the new record
 * to Google Drive (if the user is signed in). The sync is debounced so
 * back-to-back writes batch into a single upload.
 */

import { queueSync } from "./syncManager.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = "fpl_companion_backtest";
const DB_VERSION = 1;
const STORE_NAME = "backtestSnapshots";

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

/**
 * Open (or create) the IndexedDB database.
 * Returns a promise that resolves to the database instance.
 *
 * The object store uses the GW number as its key path, so each GW's
 * data is stored and retrieved by gameweek number directly.
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Called when the database is first created or version changes.
    // Sets up the object store structure.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "gw" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Save backtest data
// ---------------------------------------------------------------------------

/**
 * Save a GW's bootstrap + fixtures data to IndexedDB for future backtesting.
 *
 * Should be called at the same time as captureSnapshotIfNeeded -- when
 * the deadline has passed and we're capturing predictions. This preserves
 * the raw input data that produced those predictions.
 *
 * Skips silently if data for this GW already exists (same "capture once"
 * logic as the prediction snapshot).
 *
 * @param {number} gw - The gameweek number
 * @param {Object} bootstrap - Raw bootstrap-static response from the FPL API
 * @param {Array} fixtures - Raw fixtures array from the FPL API
 * @returns {Promise<{ saved: boolean }>}
 */
export async function saveBacktestData(gw, bootstrap, fixtures) {
  if (!gw || !bootstrap || !fixtures) {
    return { saved: false };
  }

  try {
    const db = await openDb();

    // Check if data already exists for this GW
    const existing = await getRecord(db, gw);
    if (existing) {
      return { saved: false };
    }

    // Extract only the fields relevant to the scoring pipeline.
    // This keeps each record at ~800KB-1MB instead of the full ~2MB.
    const record = {
      gw,
      capturedAt: new Date().toISOString(),
      elements: bootstrap.elements,    // all players with cumulative stats
      teams: bootstrap.teams,          // team strength ratings
      events: bootstrap.events,        // GW metadata (deadlines, finished)
      fixtures,                        // full fixture list at this point in time
    };

    // Write to IndexedDB
    await putRecord(db, record);
    console.log(`[backtestDb] Saved GW${gw} backtest data`);

    // Queue a Drive sync so this new backtest record gets backed up.
    // queueSync is debounced and no-ops if the user isn't signed in.
    queueSync();

    return { saved: true };
  } catch (err) {
    // Non-blocking: backtest storage is a bonus feature, not critical
    console.warn(`[backtestDb] Failed to save GW${gw}:`, err.message);
    return { saved: false };
  }
}

// ---------------------------------------------------------------------------
// Retrieve backtest data
// ---------------------------------------------------------------------------

/**
 * Get a single GW's backtest data from IndexedDB.
 *
 * @param {number} gw - The gameweek number
 * @returns {Promise<Object|null>} - The stored record, or null if not found
 */
export async function getBacktestData(gw) {
  try {
    const db = await openDb();
    return await getRecord(db, gw);
  } catch (err) {
    console.warn(`[backtestDb] Failed to read GW${gw}:`, err.message);
    return null;
  }
}

/**
 * List all stored backtest records (metadata only, without the large arrays).
 * Returns GW number and capture timestamp, sorted by GW descending.
 *
 * @returns {Promise<Array<{ gw: number, capturedAt: string }>>}
 */
export async function listBacktestData() {
  try {
    const db = await openDb();
    const records = await getAllRecords(db);

    // Return lightweight metadata, not the full player/fixture arrays
    return records
      .map((r) => ({ gw: r.gw, capturedAt: r.capturedAt }))
      .sort((a, b) => b.gw - a.gw);
  } catch (err) {
    console.warn("[backtestDb] Failed to list records:", err.message);
    return [];
  }
}

/**
 * Delete a single GW's backtest data from IndexedDB.
 *
 * @param {number} gw - The gameweek number to delete
 * @returns {Promise<boolean>} - True if deleted successfully
 */
export async function deleteBacktestData(gw) {
  try {
    const db = await openDb();
    await deleteRecord(db, gw);
    console.log(`[backtestDb] Deleted GW${gw} backtest data`);
    return true;
  } catch (err) {
    console.warn(`[backtestDb] Failed to delete GW${gw}:`, err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Low-level IndexedDB helpers
// ---------------------------------------------------------------------------

/**
 * Get a single record by key from the object store.
 */
function getRecord(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Write a record to the object store (insert or overwrite).
 */
function putRecord(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all records from the object store.
 */
function getAllRecords(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a single record by key.
 */
function deleteRecord(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
