/**
 * snapshots.js -- Deadline-triggered prediction snapshots
 *
 * Captures the app's predictions at GW deadline time and stores them
 * in localStorage. When the GW finishes, actual points are merged in
 * so the AccuracyTracker can compare predictions vs reality.
 *
 * Lifecycle:
 * 1. CAPTURE: When the current GW's deadline has passed and no snapshot
 *    exists for that GW yet, snapshot all qualified players' predictions.
 *    "Qualified" = 45+ SEASON minutes (not per-game).
 *
 * 2. COMPLETE: When a snapshotted GW's matches are all finished, fetch
 *    actual points from the live endpoint and merge them in.
 *    A snapshot is "complete" once actualPoints is populated.
 *
 * 3. SYNC: After capturing or completing a snapshot, queueSync() is
 *    called to push the change to Google Drive (if the user is signed
 *    in). The sync is debounced so rapid successive writes batch into
 *    a single upload.
 *
 * 4. EXPORT/IMPORT: Users can export snapshots as JSON (full structure)
 *    or CSV (flattened), and import them back. This lets users back up
 *    their accuracy history or share it.
 *
 * Storage format (localStorage):
 *   Key: "fpl_snapshot_{gw}" (e.g. "fpl_snapshot_7")
 *   Value: JSON string of {
 *     gw: number,
 *     capturedAt: ISO string,
 *     completedAt: ISO string | null,
 *     isComplete: boolean,
 *     players: [{
 *       id, webName, position, team,
 *       compositeScore, projectedPerGame, blendedScore, captaincyScore,
 *       actualPoints: number | null (filled on completion)
 *     }]
 *   }
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { queueSync } from "./syncManager.js";

const STORAGE_PREFIX = "fpl_snapshot_";

/** Minimum season minutes for a player to be included in a snapshot */
const MIN_SEASON_MINUTES = 45;

/**
 * Build the full URL for an FPL API endpoint.
 * In dev, Vite proxies /api/* to the FPL server.
 * In production, we route through allorigins.win to bypass CORS.
 */
function fplUrl(path) {
  if (import.meta.env.DEV) {
    return `/api${path}`;
  }
  return `https://fpl-proxy-rho.vercel.app/api${path}`;
}

// ---------------------------------------------------------------------------
// Snapshot capture
// ---------------------------------------------------------------------------

/**
 * Check whether a snapshot should be captured for the given GW and do it.
 *
 * Conditions for capture:
 * - The GW's deadline has passed (deadlinePassed = true)
 * - No snapshot for this GW already exists in localStorage
 * - There are qualifying players to snapshot
 *
 * @param {number} gw - The gameweek number to potentially snapshot
 * @param {boolean} deadlinePassed - Whether the GW's deadline time has passed
 * @param {Array} players - All players with scores calculated
 * @param {Object} [picks] - The user's picks object for this GW (picks.picks
 *   is the array of {element, position, ...}). When provided, the snapshot
 *   stores the squad player IDs so the AccuracyTracker can show "my squad"
 *   for the correct GW instead of using whatever squad is live later.
 * @returns {{ captured: boolean, playerCount: number }} - Result of the capture attempt
 */
export function captureSnapshotIfNeeded(gw, deadlinePassed, players, picks) {
  if (!gw || !deadlinePassed || !players?.length) {
    return { captured: false, playerCount: 0 };
  }

  // Check if snapshot already exists
  const existing = getSnapshot(gw);
  if (existing) {
    return { captured: false, playerCount: existing.players.length };
  }

  // Filter to qualified players (45+ season minutes)
  const qualified = players.filter((p) => (p.minutes || 0) >= MIN_SEASON_MINUTES);
  if (!qualified.length) {
    return { captured: false, playerCount: 0 };
  }

  // Capture squad player IDs so the accuracy tracker can filter by
  // "my squad at the time" rather than the user's current live squad.
  const squadPlayerIds = picks?.picks
    ? picks.picks.map((p) => p.element)
    : [];

  // Build snapshot data -- capture only the prediction fields we need
  const snapshot = {
    gw,
    capturedAt: new Date().toISOString(),
    completedAt: null,
    isComplete: false,
    squadPlayerIds,
    players: qualified.map((p) => ({
      id: p.id,
      webName: p.web_name,
      position: p.position_name,
      team: p.team_name,
      compositeScore: p.compositeScore ?? null,
      projectedPerGame: p.projectedPerGame ?? null,
      blendedScore: p.blendedScore ?? null,
      captaincyScore: p.captaincyScore ?? null,
      actualPoints: null, // filled when GW completes
    })),
  };

  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_PREFIX + gw, JSON.stringify(snapshot));
    console.log(`[snapshots] Captured GW${gw} snapshot: ${qualified.length} players`);

    // Queue a Drive sync so this new snapshot gets backed up.
    // queueSync is debounced and no-ops if the user isn't signed in.
    queueSync();

    return { captured: true, playerCount: qualified.length };
  } catch (err) {
    console.warn("[snapshots] Failed to save snapshot:", err.message);
    return { captured: false, playerCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Snapshot completion (merge actuals)
// ---------------------------------------------------------------------------

/**
 * Complete a snapshot by merging in actual GW points.
 *
 * This should be called when a GW's matches have all finished.
 * Fetches live data from the FPL event endpoint and writes actualPoints
 * onto each snapshotted player.
 *
 * @param {number} gw - The gameweek to complete
 * @returns {Promise<{ completed: boolean, snapshot: Object|null }>}
 */
export async function completeSnapshot(gw) {
  const snapshot = getSnapshot(gw);
  if (!snapshot) {
    return { completed: false, snapshot: null };
  }

  // Already complete -- skip
  if (snapshot.isComplete) {
    return { completed: true, snapshot };
  }

  try {
    const res = await fetch(fplUrl(`/event/${gw}/live/`));
    if (!res.ok) {
      console.warn(`[snapshots] Failed to fetch GW${gw} actuals: ${res.status}`);
      return { completed: false, snapshot };
    }

    const data = await res.json();
    if (!data.elements?.length) {
      return { completed: false, snapshot };
    }

    // Build actuals map: playerId -> total_points
    const actualsMap = {};
    for (const el of data.elements) {
      actualsMap[el.id] = el.stats?.total_points ?? 0;
    }

    // Merge actuals onto snapshot players
    for (const sp of snapshot.players) {
      sp.actualPoints = actualsMap[sp.id] ?? null;
    }

    snapshot.isComplete = true;
    snapshot.completedAt = new Date().toISOString();

    // Save updated snapshot
    try {
      localStorage.setItem(STORAGE_PREFIX + gw, JSON.stringify(snapshot));
      console.log(`[snapshots] Completed GW${gw} snapshot with actuals`);

      // Queue Drive sync so the completed snapshot (with actuals) gets backed up
      queueSync();
    } catch (err) {
      console.warn("[snapshots] Failed to save completed snapshot:", err.message);
    }

    return { completed: true, snapshot };
  } catch (err) {
    console.warn(`[snapshots] Error completing GW${gw}:`, err.message);
    return { completed: false, snapshot };
  }
}

// ---------------------------------------------------------------------------
// Snapshot retrieval
// ---------------------------------------------------------------------------

/**
 * Get a snapshot for a specific GW from localStorage.
 * Returns null if no snapshot exists or if localStorage is unavailable.
 *
 * @param {number} gw - The gameweek number
 * @returns {Object|null} - The snapshot object, or null
 */
export function getSnapshot(gw) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + gw);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * List all stored snapshots, sorted by GW number descending.
 * Returns basic metadata (gw, capturedAt, isComplete, playerCount)
 * without the full player arrays.
 *
 * @returns {Array<{ gw, capturedAt, completedAt, isComplete, playerCount }>}
 */
export function listSnapshots() {
  const snapshots = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;

      const gw = parseInt(key.slice(STORAGE_PREFIX.length), 10);
      if (isNaN(gw)) continue;

      try {
        const data = JSON.parse(localStorage.getItem(key));
        snapshots.push({
          gw,
          capturedAt: data.capturedAt,
          completedAt: data.completedAt,
          isComplete: data.isComplete,
          playerCount: data.players?.length ?? 0,
        });
      } catch {
        // Skip corrupted entries
      }
    }
  } catch {
    // localStorage not available
  }

  // Sort by GW descending (most recent first)
  snapshots.sort((a, b) => b.gw - a.gw);
  return snapshots;
}

// ---------------------------------------------------------------------------
// Export: JSON
// ---------------------------------------------------------------------------

/**
 * Export one or more snapshots as a JSON string.
 * The exported format wraps snapshots in an envelope with metadata.
 *
 * @param {number[]} gwNumbers - Which GWs to export (empty = all)
 * @returns {string} - JSON string ready for download
 */
export function exportSnapshotsJSON(gwNumbers = []) {
  const allSnapshots = [];

  if (gwNumbers.length === 0) {
    // Export all
    const listing = listSnapshots();
    for (const meta of listing) {
      const snap = getSnapshot(meta.gw);
      if (snap) allSnapshots.push(snap);
    }
  } else {
    for (const gw of gwNumbers) {
      const snap = getSnapshot(gw);
      if (snap) allSnapshots.push(snap);
    }
  }

  const envelope = {
    exportedAt: new Date().toISOString(),
    format: "fpl-companion-snapshots-v1",
    count: allSnapshots.length,
    snapshots: allSnapshots,
  };

  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Export: CSV
// ---------------------------------------------------------------------------

/**
 * Export one or more snapshots as a CSV string.
 * Flattened format: one row per player per GW.
 *
 * Columns: gw, playerId, playerName, position, team, compositeScore,
 *          projectedPerGame, blendedScore, captaincyScore, actualPoints
 *
 * @param {number[]} gwNumbers - Which GWs to export (empty = all)
 * @returns {string} - CSV string ready for download
 */
export function exportSnapshotsCSV(gwNumbers = []) {
  const header = [
    "gw", "playerId", "playerName", "position", "team",
    "compositeScore", "projectedPerGame", "blendedScore",
    "captaincyScore", "actualPoints",
  ].join(",");

  const rows = [header];

  const gwsToExport = gwNumbers.length > 0
    ? gwNumbers
    : listSnapshots().map((s) => s.gw);

  for (const gw of gwsToExport) {
    const snap = getSnapshot(gw);
    if (!snap) continue;

    for (const p of snap.players) {
      // Escape commas in player names (rare but safe)
      const name = p.webName.includes(",") ? `"${p.webName}"` : p.webName;
      rows.push([
        gw,
        p.id,
        name,
        p.position,
        p.team,
        p.compositeScore?.toFixed(1) ?? "",
        p.projectedPerGame?.toFixed(2) ?? "",
        p.blendedScore?.toFixed(1) ?? "",
        p.captaincyScore?.toFixed(1) ?? "",
        p.actualPoints ?? "",
      ].join(","));
    }
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import snapshots from a JSON string.
 * Validates the format and merges into localStorage (doesn't overwrite
 * existing snapshots for the same GW unless they're incomplete and the
 * import has a complete version).
 *
 * @param {string} jsonStr - The JSON string to import
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export function importSnapshotsJSON(jsonStr) {
  const result = { imported: 0, skipped: 0, errors: [] };

  try {
    const data = JSON.parse(jsonStr);

    // Validate envelope format
    if (!data.snapshots || !Array.isArray(data.snapshots)) {
      result.errors.push("Invalid format: expected { snapshots: [...] }");
      return result;
    }

    for (const snap of data.snapshots) {
      // Basic validation
      if (!snap.gw || !snap.players?.length) {
        result.errors.push(`Skipped invalid snapshot (GW${snap.gw || "?"}): missing gw or players`);
        result.skipped++;
        continue;
      }

      // Check existing
      const existing = getSnapshot(snap.gw);
      if (existing) {
        // Only overwrite if the import has actuals and existing doesn't
        if (existing.isComplete || !snap.isComplete) {
          result.skipped++;
          continue;
        }
      }

      // Save to localStorage
      try {
        localStorage.setItem(STORAGE_PREFIX + snap.gw, JSON.stringify(snap));
        result.imported++;
      } catch (err) {
        result.errors.push(`Failed to save GW${snap.gw}: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(`JSON parse error: ${err.message}`);
  }

  return result;
}

/**
 * Import snapshots from a CSV string.
 * Reconstructs snapshot objects from flattened CSV rows and stores them.
 *
 * @param {string} csvStr - The CSV string to import
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export function importSnapshotsCSV(csvStr) {
  const result = { imported: 0, skipped: 0, errors: [] };

  try {
    const lines = csvStr.trim().split("\n");
    if (lines.length < 2) {
      result.errors.push("CSV has no data rows");
      return result;
    }

    // Skip header, group rows by GW
    const gwGroups = {};

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 10) {
        result.errors.push(`Row ${i + 1}: expected 10 columns, got ${cols.length}`);
        continue;
      }

      const gw = parseInt(cols[0], 10);
      if (isNaN(gw)) continue;

      if (!gwGroups[gw]) gwGroups[gw] = [];

      gwGroups[gw].push({
        id: parseInt(cols[1], 10),
        webName: cols[2],
        position: cols[3],
        team: cols[4],
        compositeScore: cols[5] ? parseFloat(cols[5]) : null,
        projectedPerGame: cols[6] ? parseFloat(cols[6]) : null,
        blendedScore: cols[7] ? parseFloat(cols[7]) : null,
        captaincyScore: cols[8] ? parseFloat(cols[8]) : null,
        actualPoints: cols[9] ? parseInt(cols[9], 10) : null,
      });
    }

    // Build and store snapshots per GW
    for (const [gwStr, players] of Object.entries(gwGroups)) {
      const gw = parseInt(gwStr, 10);
      const hasActuals = players.some((p) => p.actualPoints != null);

      // Check existing
      const existing = getSnapshot(gw);
      if (existing?.isComplete) {
        result.skipped++;
        continue;
      }

      const snap = {
        gw,
        capturedAt: new Date().toISOString(), // approximate
        completedAt: hasActuals ? new Date().toISOString() : null,
        isComplete: hasActuals,
        players,
      };

      try {
        localStorage.setItem(STORAGE_PREFIX + gw, JSON.stringify(snap));
        result.imported++;
      } catch (err) {
        result.errors.push(`Failed to save GW${gw}: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(`CSV parse error: ${err.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CSV parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line, respecting quoted fields (for names with commas).
 * Simple implementation that handles the most common cases.
 *
 * @param {string} line - A single CSV row
 * @returns {string[]} - Array of field values
 */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Auto-completion check
// ---------------------------------------------------------------------------

/**
 * Check all incomplete snapshots and attempt to complete them.
 * Call this on app load to auto-fill actuals for GWs that have
 * finished since the last session.
 *
 * @param {Array} events - The events array from bootstrap (to check which GWs are finished)
 * @param {string|number} [teamId] - The user's FPL team ID (for backfilling squad IDs)
 * @returns {Promise<number>} - Number of snapshots completed
 */
export async function autoCompleteSnapshots(events, teamId) {
  if (!events?.length) return 0;

  // Backfill squadPlayerIds for any legacy snapshots missing them
  if (teamId) {
    await backfillSnapshotSquads(teamId);
  }

  const listing = listSnapshots();
  let completedCount = 0;

  for (const meta of listing) {
    if (meta.isComplete) continue;

    // Check if this GW is finished (all matches done)
    const event = events.find((e) => e.id === meta.gw);
    if (!event?.finished) continue;

    // GW is finished but snapshot lacks actuals -- complete it
    const { completed } = await completeSnapshot(meta.gw);
    if (completed) completedCount++;
  }

  return completedCount;
}

// ---------------------------------------------------------------------------
// Backfill: patch squadPlayerIds into legacy snapshots
// ---------------------------------------------------------------------------

/**
 * One-time migration for snapshots captured before the squadPlayerIds fix.
 * Scans all stored snapshots; for any that lack squadPlayerIds (or have an
 * empty array), fetches the user's picks for that GW from the FPL API and
 * patches the snapshot in localStorage.
 *
 * This runs automatically on app load via autoCompleteSnapshots and is
 * safe to call multiple times -- once a snapshot has squadPlayerIds it's
 * skipped.
 *
 * @param {string|number} teamId - The user's FPL team ID
 */
async function backfillSnapshotSquads(teamId) {
  if (!teamId) return;

  const listing = listSnapshots();

  for (const meta of listing) {
    const snapshot = getSnapshot(meta.gw);
    if (!snapshot) continue;

    // Skip if this snapshot already has squad IDs stored
    if (snapshot.squadPlayerIds?.length) continue;

    // Try to fetch picks for this GW from the API
    try {
      const res = await fetch(fplUrl(`/entry/${teamId}/event/${meta.gw}/picks/`));
      if (!res.ok) continue;

      const picksData = await res.json();
      if (!picksData.picks?.length) continue;

      // Patch the snapshot with the squad player IDs
      snapshot.squadPlayerIds = picksData.picks.map((p) => p.element);
      localStorage.setItem(STORAGE_PREFIX + meta.gw, JSON.stringify(snapshot));
      console.log(`[snapshots] Backfilled squadPlayerIds for GW${meta.gw}`);
    } catch {
      // API unavailable for this GW -- skip silently
    }
  }
}

// ---------------------------------------------------------------------------
// Download helper (triggers browser file download)
// ---------------------------------------------------------------------------

/**
 * Trigger a file download in the browser.
 *
 * @param {string} content - File content string
 * @param {string} filename - Suggested filename
 * @param {string} mimeType - MIME type (e.g. "application/json", "text/csv")
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
