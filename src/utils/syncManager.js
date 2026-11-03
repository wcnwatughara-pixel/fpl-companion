/**
 * syncManager.js -- Orchestration layer for Google Drive sync
 *
 * Sits between the app's data stores (localStorage snapshots, IndexedDB
 * backtest data) and the Drive API wrapper (driveSync.js). Handles:
 *
 * 1. GATHERING: Collects all data from localStorage + IndexedDB into
 *    a single JSON backup object.
 *
 * 2. UPLOADING: Pushes the gathered data to Drive on a debounced schedule.
 *    Multiple rapid writes (e.g. snapshot capture + backtest save in the
 *    same load cycle) are batched into a single Drive upload.
 *
 * 3. RESTORING: Downloads backup from Drive and writes it back into
 *    localStorage + IndexedDB, merging by GW key.
 *
 * 4. SYNC QUEUE: Queues sync attempts and retries with exponential backoff
 *    when the network or Drive is unavailable.
 *
 * 5. STATUS: Exposes sync status (synced / pending / error) for the UI.
 *
 * Backup JSON format:
 *   {
 *     version: 1,
 *     exportedAt: ISO string,
 *     teamId: string,
 *     snapshots: { "6": {...}, "7": {...}, ... },  // keyed by GW
 *     backtestRecords: { "6": {...}, "7": {...}, ... },  // keyed by GW
 *   }
 */

import { isSignedIn, uploadBackup, downloadBackup, onAuthChange } from "./driveSync.js";
import { listBacktestData, getBacktestData, saveBacktestData } from "./backtestDb.js";
import { getSnapshot, listSnapshots } from "./snapshots.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current backup format version. Bump if the schema changes. */
const BACKUP_VERSION = 1;

/**
 * Debounce delay in ms before syncing to Drive after a data change.
 * Batches rapid successive writes (snapshot + backtest in same cycle)
 * into a single upload.
 */
const SYNC_DEBOUNCE_MS = 5000;

/**
 * Maximum number of retry attempts before giving up on a sync.
 * After this many failures the status moves to "error" and stays
 * there until the next manual or data-triggered sync attempt.
 */
const MAX_RETRIES = 5;

/**
 * Base delay for exponential backoff (ms).
 * Retry delays: 30s, 60s, 120s, 240s, 480s
 */
const BASE_RETRY_DELAY_MS = 30000;

/** localStorage key for tracking last successful sync time */
const LAST_SYNC_KEY = "fpl_drive_last_sync";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/**
 * Sync status values:
 *   "idle"    - no sync activity, everything is up to date
 *   "pending" - local changes exist that haven't been synced yet
 *   "syncing" - actively uploading to Drive right now
 *   "error"   - last sync attempt failed (will auto-retry)
 */
let syncStatus = "idle";

/** Human-readable error message when status is "error" */
let lastError = null;

/** Timer ID for the debounced sync */
let debounceTimer = null;

/** Current retry count for the active sync attempt */
let retryCount = 0;

/** Timer ID for retry backoff */
let retryTimer = null;

/** Listeners for sync status changes */
const statusListeners = new Set();

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

/**
 * Get the current sync status.
 * @returns {{ status: string, error: string|null, lastSync: string|null }}
 */
export function getSyncStatus() {
  return {
    status: syncStatus,
    error: lastError,
    lastSync: getLastSyncTime(),
  };
}

/**
 * Subscribe to sync status changes.
 * Listener receives the status object from getSyncStatus().
 *
 * @param {Function} listener
 * @returns {Function} - Unsubscribe function
 */
export function onSyncStatusChange(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Update status and notify all listeners */
function setStatus(newStatus, error = null) {
  syncStatus = newStatus;
  lastError = error;
  const statusObj = getSyncStatus();
  for (const fn of statusListeners) {
    try {
      fn(statusObj);
    } catch (err) {
      console.warn("[syncManager] Listener error:", err);
    }
  }
}

/** Get the last successful sync timestamp from localStorage */
function getLastSyncTime() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY) || null;
  } catch {
    return null;
  }
}

/** Save the current time as last successful sync */
function setLastSyncTime() {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Gather all data into backup object
// ---------------------------------------------------------------------------

/**
 * Collect all app data from localStorage + IndexedDB into a single
 * backup object suitable for uploading to Drive.
 *
 * @returns {Promise<Object>} - The complete backup object
 */
async function gatherBackupData() {
  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    teamId: null,
    snapshots: {},
    backtestRecords: {},
  };

  // 1. Team ID from localStorage
  try {
    backup.teamId = localStorage.getItem("fpl_team_id") || null;
  } catch {
    // localStorage unavailable
  }

  // 2. All prediction snapshots from localStorage
  const snapshotList = listSnapshots();
  for (const meta of snapshotList) {
    const snap = getSnapshot(meta.gw);
    if (snap) {
      // Key by GW number for easy merge-by-key on restore
      backup.snapshots[String(meta.gw)] = snap;
    }
  }

  // 3. All backtest records from IndexedDB
  // We need full records (with elements/teams/events/fixtures),
  // not just metadata, so fetch each one individually.
  const backtestList = await listBacktestData();
  for (const meta of backtestList) {
    const record = await getBacktestData(meta.gw);
    if (record) {
      backup.backtestRecords[String(meta.gw)] = record;
    }
  }

  return backup;
}

// ---------------------------------------------------------------------------
// Sync to Drive (upload)
// ---------------------------------------------------------------------------

/**
 * Queue a sync to Google Drive. This is the function that other parts
 * of the app should call whenever data changes (snapshot captured,
 * backtest saved, team ID changed, etc.).
 *
 * Uses debouncing so multiple rapid calls result in a single upload.
 * If not signed in, the call is silently ignored (no error).
 */
export function queueSync() {
  // Don't queue if not signed in -- sync is opt-in
  if (!isSignedIn()) return;

  // Clear any existing debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Mark as pending so the UI shows "unsaved changes"
  setStatus("pending");

  // Debounce: wait for writes to settle before uploading
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    performSync();
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Force an immediate sync to Drive, bypassing the debounce.
 * Used by the "Force Sync" button in settings.
 *
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function forceSync() {
  // Clear any pending debounce
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  // Clear any pending retry
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  retryCount = 0;
  return performSync();
}

/**
 * Execute the actual sync: gather data, upload to Drive.
 * Handles retries with exponential backoff on failure.
 *
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function performSync() {
  if (!isSignedIn()) {
    setStatus("idle");
    return { success: false, error: "Not signed in" };
  }

  setStatus("syncing");

  try {
    // Gather all local data
    const backup = await gatherBackupData();
    const jsonString = JSON.stringify(backup);

    // Upload to Drive
    const result = await uploadBackup(jsonString);

    if (result.success) {
      retryCount = 0;
      setLastSyncTime();
      setStatus("idle");
      console.log("[syncManager] Sync complete");
      return { success: true };
    } else {
      // Upload failed -- schedule retry if under the limit
      return handleSyncFailure(result.error);
    }
  } catch (err) {
    return handleSyncFailure(err.message);
  }
}

/**
 * Handle a sync failure: increment retry count and schedule
 * a retry with exponential backoff, or give up if max retries
 * exceeded.
 */
function handleSyncFailure(errorMsg) {
  retryCount++;
  console.warn(`[syncManager] Sync failed (attempt ${retryCount}):`, errorMsg);

  if (retryCount >= MAX_RETRIES) {
    // Give up -- user needs to intervene
    setStatus("error", `Sync failed after ${MAX_RETRIES} attempts: ${errorMsg}`);
    retryCount = 0;
    return { success: false, error: errorMsg };
  }

  // Schedule retry with exponential backoff
  // Delays: 30s, 60s, 120s, 240s, 480s
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount - 1);
  console.log(`[syncManager] Retrying in ${delay / 1000}s...`);

  setStatus("pending", `Retry ${retryCount}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s`);

  retryTimer = setTimeout(() => {
    retryTimer = null;
    performSync();
  }, delay);

  return { success: false, error: errorMsg };
}

// ---------------------------------------------------------------------------
// Restore from Drive (download)
// ---------------------------------------------------------------------------

/**
 * Download the backup from Google Drive and restore it into
 * localStorage + IndexedDB.
 *
 * Merge strategy:
 * - Team ID: overwrite local with backup value (last-write-wins)
 * - Snapshots: merge by GW key. Backup wins if local is missing
 *   or incomplete and backup is complete. Local wins if it's
 *   already complete (preserves any local corrections).
 * - Backtest records: merge by GW key. Backup wins if local is
 *   missing. Local wins if it already has data for that GW.
 *
 * @returns {Promise<{ success: boolean, restored: Object, error?: string }>}
 *   restored contains counts: { teamId, snapshots, backtestRecords }
 */
export async function restoreFromDrive() {
  if (!isSignedIn()) {
    return { success: false, restored: null, error: "Not signed in" };
  }

  try {
    const result = await downloadBackup();

    if (!result.success) {
      return { success: false, restored: null, error: result.error };
    }

    const backup = result.data;

    // Validate backup format
    if (!backup || backup.version !== BACKUP_VERSION) {
      return {
        success: false,
        restored: null,
        error: `Unsupported backup version: ${backup?.version ?? "unknown"}`,
      };
    }

    const counts = {
      teamId: false,
      snapshots: 0,
      backtestRecords: 0,
    };

    // 1. Restore team ID (last-write-wins)
    if (backup.teamId) {
      try {
        localStorage.setItem("fpl_team_id", backup.teamId);
        counts.teamId = true;
      } catch {
        // localStorage unavailable
      }
    }

    // 2. Restore snapshots (merge by GW key)
    if (backup.snapshots) {
      for (const [gwStr, snap] of Object.entries(backup.snapshots)) {
        const gw = parseInt(gwStr, 10);
        if (isNaN(gw) || !snap) continue;

        const existing = getSnapshot(gw);

        // Skip if local copy is already complete
        if (existing?.isComplete) continue;

        // Restore if local is missing or incomplete and backup has data
        try {
          localStorage.setItem(`fpl_snapshot_${gw}`, JSON.stringify(snap));
          counts.snapshots++;
        } catch {
          // localStorage full or unavailable
        }
      }
    }

    // 3. Restore backtest records (merge by GW key)
    if (backup.backtestRecords) {
      for (const [gwStr, record] of Object.entries(backup.backtestRecords)) {
        const gw = parseInt(gwStr, 10);
        if (isNaN(gw) || !record) continue;

        // Check if local already has this GW's backtest data
        const existingBacktest = await getBacktestData(gw);
        if (existingBacktest) continue;

        // Restore via saveBacktestData -- it handles the IndexedDB write
        // But saveBacktestData expects bootstrap + fixtures separately,
        // so we reconstruct the call from the stored record.
        // Since the record IS what saveBacktestData stored, we can write
        // directly to IndexedDB using a simplified path.
        try {
          await restoreBacktestRecord(record);
          counts.backtestRecords++;
        } catch (err) {
          console.warn(`[syncManager] Failed to restore backtest GW${gw}:`, err.message);
        }
      }
    }

    console.log("[syncManager] Restore complete:", counts);
    return { success: true, restored: counts };
  } catch (err) {
    console.error("[syncManager] Restore error:", err);
    return { success: false, restored: null, error: err.message };
  }
}

/**
 * Write a backtest record directly to IndexedDB.
 * This bypasses saveBacktestData's "skip if exists" check because
 * we've already verified the record doesn't exist locally.
 *
 * @param {Object} record - The full backtest record (gw, capturedAt, elements, teams, events, fixtures)
 */
async function restoreBacktestRecord(record) {
  const DB_NAME = "fpl_companion_backtest";
  const DB_VERSION = 1;
  const STORE_NAME = "backtestSnapshots";

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "gw" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the sync manager. Call once at app startup, after
 * initDriveAuth() has been called.
 *
 * Sets up listeners for auth changes so we can sync immediately
 * after sign-in and stop syncing after sign-out.
 */
export function initSyncManager() {
  // Listen for auth changes
  onAuthChange(() => {
    if (isSignedIn()) {
      // Just signed in -- do an initial sync to push any local data
      console.log("[syncManager] Auth change: signed in, queuing sync");
      queueSync();
    } else {
      // Signed out -- cancel any pending syncs
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      setStatus("idle");
    }
  });

  // Request persistent storage so the browser is less likely to
  // evict our localStorage/IndexedDB data in the first place
  if (navigator.storage?.persist) {
    navigator.storage.persist().then((granted) => {
      console.log(`[syncManager] Persistent storage ${granted ? "granted" : "denied"}`);
    });
  }
}
