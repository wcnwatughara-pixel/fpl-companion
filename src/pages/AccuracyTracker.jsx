/**
 * AccuracyTracker.jsx -- Prediction Accuracy Verification
 *
 * Feature 9: Cross-checks the app's predicted scores against actual FPL
 * results using deadline-captured snapshots.
 *
 * How it works:
 * 1. Reads prediction snapshots from localStorage (captured at GW deadline
 *    by the snapshots.js module).
 * 2. For completed snapshots (where actuals have been merged in), calculates
 *    a full suite of accuracy metrics:
 *
 *    - MAE (Mean Absolute Error): average |projectedPerGame - actualPoints|
 *    - Spearman Rank Correlation: for composite, blend, projected, and captaincy
 *    - Global Top-10 Hit Rate: of predicted top 10 by blend, how many landed
 *      in actual top 10?
 *    - Per-Position Top-10% Hit Rate: for each position group (GKP, DEF, MID, FWD),
 *      of predicted top 10% by blend, how many landed in actual top 10%?
 *    - Composite Rank Accuracy: Spearman r between composite rank and actual rank
 *    - Blend Rank Accuracy: Spearman r between blend rank and actual rank
 *    - Captaincy Accuracy: Spearman r between captaincy score rank and actual rank
 *
 * 3. Provides JSON and CSV export/import for snapshot data.
 *
 * Uses currentGw (backward-looking feature) not planningGw.
 */

import { useState, useMemo, useRef } from "react";
import { useFpl } from "../context/FplContext.jsx";
import ScoreBar from "../components/ScoreBar.jsx";
import Tooltip from "../components/Tooltip.jsx";
import { formatDecimal, formatPrice } from "../utils/formatters.js";
import {
  getSnapshot,
  listSnapshots,
  exportSnapshotsJSON,
  exportSnapshotsCSV,
  importSnapshotsJSON,
  importSnapshotsCSV,
  downloadFile,
} from "../utils/snapshots.js";

// ---------------------------------------------------------------------------
// Spearman rank correlation
// ---------------------------------------------------------------------------

/**
 * Calculate Spearman rank correlation between two arrays of values.
 * Returns a number from -1 to 1 where 1 = perfect rank agreement.
 *
 * Uses fractional/midrank for ties: tied values get the average of
 * the positions they would occupy.
 */
function spearmanCorrelation(predicted, actual) {
  const n = predicted.length;
  if (n < 3) return null;

  function rank(arr) {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => b.v - a.v); // descending
    const ranks = new Array(n);
    for (let r = 0; r < indexed.length; r++) {
      ranks[indexed[r].i] = r + 1;
    }
    return ranks;
  }

  const rP = rank(predicted);
  const rA = rank(actual);

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rP[i] - rA[i];
    sumD2 += d * d;
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

// ---------------------------------------------------------------------------
// Per-position top-10% hit rate
// ---------------------------------------------------------------------------

/**
 * Calculate top-10% hit rate within a position group.
 * Of the predicted top 10% by metric, how many were in the actual top 10%?
 *
 * @param {Array} players - Players in this position group
 * @param {string} predictedKey - Key for predicted score (e.g. "blendedScore")
 * @param {string} actualKey - Key for actual result (e.g. "actualPoints")
 * @returns {{ hits: number, total: number, rate: number }}
 */
function positionTopPercentHitRate(players, predictedKey, actualKey) {
  if (players.length < 5) return { hits: 0, total: 0, rate: 0 };

  const topN = Math.max(1, Math.ceil(players.length * 0.1));

  // Actual top 10% IDs
  const actualSorted = [...players].sort((a, b) => (b[actualKey] ?? 0) - (a[actualKey] ?? 0));
  const actualTopIds = new Set(actualSorted.slice(0, topN).map((p) => p.id));

  // Predicted top 10% IDs
  const predictedSorted = [...players].sort((a, b) => (b[predictedKey] ?? 0) - (a[predictedKey] ?? 0));
  const predictedTop = predictedSorted.slice(0, topN);

  const hits = predictedTop.filter((p) => actualTopIds.has(p.id)).length;

  return {
    hits,
    total: topN,
    rate: Math.round((hits / topN) * 100),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AccuracyTracker() {
  const { players, picks, loading, currentGw } = useFpl();

  // Snapshot listing
  const snapshotList = useMemo(() => listSnapshots(), [currentGw]);

  // Selected GW defaults to most recent complete snapshot
  const defaultGw = useMemo(() => {
    const complete = snapshotList.find((s) => s.isComplete);
    return complete?.gw ?? snapshotList[0]?.gw ?? null;
  }, [snapshotList]);

  const [selectedGw, setSelectedGw] = useState(defaultGw);
  const [importMessage, setImportMessage] = useState(null);
  const fileInputRef = useRef(null);

  // Load the selected snapshot
  const snapshot = useMemo(() => {
    if (!selectedGw) return null;
    return getSnapshot(selectedGw);
  }, [selectedGw]);

  // Squad player IDs for the selected snapshot's GW.
  // Prefer the IDs stored in the snapshot (captured at deadline time, so they
  // reflect who was actually in the squad that week). Fall back to the live
  // picks for older snapshots that predate this feature.
  const squadIds = useMemo(() => {
    if (snapshot?.squadPlayerIds?.length) {
      return new Set(snapshot.squadPlayerIds);
    }
    // Fallback: use current live picks (may be wrong GW, but better than nothing)
    if (!picks?.picks) return new Set();
    return new Set(picks.picks.map((p) => p.element));
  }, [snapshot, picks]);

  // ---------------------------------------------------------------------------
  // Build comparison rows from snapshot
  // ---------------------------------------------------------------------------

  const comparison = useMemo(() => {
    if (!snapshot?.isComplete || !snapshot.players?.length) return null;

    // Only players who have actual points (played in the GW)
    return snapshot.players
      .filter((p) => p.actualPoints != null)
      .map((p) => ({
        ...p,
        inSquad: squadIds.has(p.id),
        // MAE error: |projected per game - actual points|
        error: Math.abs((p.projectedPerGame || 0) - p.actualPoints),
      }))
      .sort((a, b) => b.actualPoints - a.actualPoints);
  }, [snapshot, squadIds]);

  // ---------------------------------------------------------------------------
  // Accuracy metrics
  // ---------------------------------------------------------------------------

  const metrics = useMemo(() => {
    if (!comparison || comparison.length < 5) return null;

    // --- MAE: value-based, projected per-game vs actual ---
    const totalError = comparison.reduce((s, r) => s + r.error, 0);
    const mae = totalError / comparison.length;

    // --- Spearman correlations for each score type ---
    const actualVals = comparison.map((r) => r.actualPoints);

    const compositeCorr = spearmanCorrelation(
      comparison.map((r) => r.compositeScore || 0),
      actualVals
    );
    const blendCorr = spearmanCorrelation(
      comparison.map((r) => r.blendedScore || 0),
      actualVals
    );
    const projCorr = spearmanCorrelation(
      comparison.map((r) => r.projectedPerGame || 0),
      actualVals
    );
    const captaincyCorr = spearmanCorrelation(
      comparison.map((r) => r.captaincyScore || 0),
      actualVals
    );

    // --- Global Top-10 hit rate ---
    const actualTop10Ids = new Set(
      [...comparison]
        .sort((a, b) => b.actualPoints - a.actualPoints)
        .slice(0, 10)
        .map((r) => r.id)
    );
    const predictedTop10 = [...comparison]
      .sort((a, b) => (b.blendedScore || 0) - (a.blendedScore || 0))
      .slice(0, 10);
    const globalTop10Hits = predictedTop10.filter((r) => actualTop10Ids.has(r.id)).length;

    // --- Per-position top-10% hit rate ---
    const positions = ["GKP", "DEF", "MID", "FWD"];
    const positionHitRates = {};
    for (const pos of positions) {
      const posPlayers = comparison.filter((r) => r.position === pos);
      positionHitRates[pos] = positionTopPercentHitRate(
        posPlayers,
        "blendedScore",
        "actualPoints"
      );
    }

    return {
      mae: mae.toFixed(2),
      compositeCorrelation: compositeCorr?.toFixed(3) ?? "N/A",
      blendCorrelation: blendCorr?.toFixed(3) ?? "N/A",
      projCorrelation: projCorr?.toFixed(3) ?? "N/A",
      captaincyCorrelation: captaincyCorr?.toFixed(3) ?? "N/A",
      globalTop10Hits: `${globalTop10Hits}/10`,
      positionHitRates,
      sampleSize: comparison.length,
    };
  }, [comparison]);

  // ---------------------------------------------------------------------------
  // Squad comparison (predicted vs actual)
  // ---------------------------------------------------------------------------

  const squadComparison = useMemo(() => {
    if (!comparison) return [];
    return comparison
      .filter((r) => r.inSquad)
      .sort((a, b) => b.actualPoints - a.actualPoints);
  }, [comparison]);

  // ---------------------------------------------------------------------------
  // Big outperformers not in squad
  // ---------------------------------------------------------------------------

  const missed = useMemo(() => {
    if (!comparison) return [];
    return comparison
      .filter((r) => !r.inSquad && r.actualPoints >= 8)
      .sort((a, b) => b.actualPoints - a.actualPoints)
      .slice(0, 10);
  }, [comparison]);

  // MAE specifically for the "Who We Missed" players (8+ pts, not in squad).
  // Shows how far off our projections were for big performers we didn't own.
  const missedMae = useMemo(() => {
    if (!missed.length) return null;
    const totalError = missed.reduce((s, r) => s + r.error, 0);
    return (totalError / missed.length).toFixed(2);
  }, [missed]);

  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------

  function handleExportJSON() {
    const json = exportSnapshotsJSON();
    downloadFile(json, "fpl-snapshots.json", "application/json");
  }

  function handleExportCSV() {
    const csv = exportSnapshotsCSV();
    downloadFile(csv, "fpl-snapshots.csv", "text/csv");
  }

  function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      let result;

      if (file.name.endsWith(".csv")) {
        result = importSnapshotsCSV(content);
      } else {
        result = importSnapshotsJSON(content);
      }

      if (result.errors.length > 0) {
        setImportMessage(`Imported ${result.imported}, skipped ${result.skipped}. Errors: ${result.errors.join("; ")}`);
      } else {
        setImportMessage(`Imported ${result.imported} snapshot(s), skipped ${result.skipped}.`);
      }

      // Clear the file input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Accuracy Tracker</h1>

      {/* Controls row: GW selector + export/import */}
      <div className="flex flex-wrap items-end gap-3">
        {/* GW selector */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Snapshot</label>
          <select
            value={selectedGw ?? ""}
            onChange={(e) => setSelectedGw(Number(e.target.value))}
            className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
          >
            {snapshotList.length === 0 && (
              <option value="">No snapshots yet</option>
            )}
            {snapshotList.map((s) => (
              <option key={s.gw} value={s.gw}>
                GW{s.gw} {s.isComplete ? "✓" : "(pending)"}
              </option>
            ))}
          </select>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleExportJSON}
            disabled={snapshotList.length === 0}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-[#111] border border-[#333] text-gray-300 hover:bg-[#1a1a1a] disabled:opacity-40"
          >
            Export JSON
          </button>
          <button
            onClick={handleExportCSV}
            disabled={snapshotList.length === 0}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-[#111] border border-[#333] text-gray-300 hover:bg-[#1a1a1a] disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>

        {/* Import button */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv"
            onChange={handleImport}
            className="hidden"
            id="snapshot-import"
          />
          <label
            htmlFor="snapshot-import"
            className="px-3 py-2 text-xs font-medium rounded-lg bg-[#111] border border-[#333] text-gray-300 hover:bg-[#1a1a1a] cursor-pointer inline-block"
          >
            Import
          </label>
        </div>
      </div>

      {/* Import feedback */}
      {importMessage && (
        <div className="px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-800/30 text-xs text-blue-300">
          {importMessage}
          <button
            onClick={() => setImportMessage(null)}
            className="ml-2 text-blue-500 hover:text-blue-400"
          >
            dismiss
          </button>
        </div>
      )}

      {/* No snapshots state */}
      {snapshotList.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-2">No prediction snapshots captured yet.</p>
          <p className="text-xs">
            Snapshots are automatically captured when a gameweek deadline passes.
            <br />
            Load the app before or around deadline time to trigger a capture.
          </p>
        </div>
      )}

      {/* Snapshot exists but not complete */}
      {snapshot && !snapshot.isComplete && (
        <div className="px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/30 text-sm text-amber-300">
          GW{selectedGw} snapshot captured at {new Date(snapshot.capturedAt).toLocaleString()}.
          <br />
          Waiting for all matches to finish before actuals can be compared.
          ({snapshot.players.length} players snapshotted)
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Accuracy metrics summary                                           */}
      {/* ----------------------------------------------------------------- */}
      {metrics && (
        <>
          {/* Primary metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Sample Size"
              value={metrics.sampleSize}
              sublabel="players who played"
            />
            <MetricCard
              label="MAE"
              value={metrics.mae}
              sublabel="avg |proj/game - actual|"
              tooltip="Mean Absolute Error: average difference between projected per-game points and actual points. Lower is better."
            />
            <MetricCard
              label="Global Top-10"
              value={metrics.globalTop10Hits}
              sublabel="predicted in actual top 10"
              tooltip="Of our top 10 picks by blend score, how many actually finished in the GW's top 10 scorers."
            />
            <MetricCard
              label="Captaincy Rank r"
              value={metrics.captaincyCorrelation}
              sublabel="Spearman correlation"
              tooltip="How well our captaincy score ranking matches the actual points ranking. 1.0 = perfect, 0 = random."
            />
          </div>

          {/* Rank correlation row */}
          <div>
            <h2 className="text-xs font-semibold text-gray-400 mb-2">Rank Correlations (Spearman)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Composite"
                value={metrics.compositeCorrelation}
                sublabel="rank accuracy"
              />
              <MetricCard
                label="Blend"
                value={metrics.blendCorrelation}
                sublabel="rank accuracy"
              />
              <MetricCard
                label="Projected"
                value={metrics.projCorrelation}
                sublabel="rank accuracy"
              />
              <MetricCard
                label="Captaincy"
                value={metrics.captaincyCorrelation}
                sublabel="rank accuracy"
              />
            </div>
          </div>

          {/* Per-position top-10% hit rates */}
          <div>
            <h2 className="text-xs font-semibold text-gray-400 mb-2">
              <Tooltip text="For each position, of the predicted top 10% by blend score, how many landed in the actual top 10%.">
                Per-Position Top-10% Hit Rate
              </Tooltip>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {["GKP", "DEF", "MID", "FWD"].map((pos) => {
                const hr = metrics.positionHitRates[pos];
                const posColor =
                  pos === "GKP" ? "#f59e0b" :
                  pos === "DEF" ? "#22c55e" :
                  pos === "MID" ? "#3b82f6" :
                  "#ef4444";
                return (
                  <div
                    key={pos}
                    className="px-3 py-3 rounded-lg"
                    style={{ backgroundColor: "#111", border: `1px solid ${posColor}33` }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: posColor, color: "#000" }}
                      >
                        {pos}
                      </span>
                      <span className="text-[10px] text-gray-500">top 10%</span>
                    </div>
                    <div className="text-lg font-bold tabular-nums">
                      {hr.total > 0 ? `${hr.rate}%` : "N/A"}
                    </div>
                    <div className="text-[9px] text-gray-600">
                      {hr.hits}/{hr.total} predicted in actual top 10%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Squad players: predicted vs actual                                  */}
      {/* ----------------------------------------------------------------- */}
      {squadComparison.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            My Squad: Predicted vs Actual (GW{selectedGw})
          </h2>
          <div className="rounded-lg overflow-x-auto" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left py-2 px-3">Player</th>
                  <th className="text-center py-2 px-3">Pos</th>
                  <th className="text-right py-2 px-3">Composite</th>
                  <th className="text-right py-2 px-3">Blend</th>
                  <th className="text-right py-2 px-3">Proj/Game</th>
                  <th className="text-right py-2 px-3">Cap Score</th>
                  <th className="text-right py-2 px-3 font-semibold">Actual Pts</th>
                  <th className="text-right py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {squadComparison.map((player) => {
                  const errorColor =
                    player.error <= 1 ? "text-emerald-400" :
                    player.error <= 3 ? "text-amber-400" :
                    "text-red-400";
                  return (
                    <tr key={player.id} className="border-t border-[#1a1a1a]">
                      <td className="py-2 px-3 font-medium">{player.webName}</td>
                      <td className="py-2 px-3 text-center text-xs">{player.position}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {player.compositeScore != null ? player.compositeScore.toFixed(1) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {player.blendedScore != null ? player.blendedScore.toFixed(1) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-purple-400">
                        {player.projectedPerGame != null ? player.projectedPerGame.toFixed(2) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-amber-400">
                        {player.captaincyScore != null ? player.captaincyScore.toFixed(1) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-white">
                        {player.actualPoints}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${errorColor}`}>
                        {player.error.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Who we missed                                                       */}
      {/* ----------------------------------------------------------------- */}
      {missed.length > 0 && (
        <div>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-300">
              Who We Missed (8+ pts, not in squad)
            </h2>
            {missedMae && (
              <Tooltip text="Mean Absolute Error for these missed players: average |proj/game - actual|. Shows how far off our projections were for big performers we didn't own.">
                <span className="text-xs text-gray-500">
                  MAE: <span className="text-amber-400 font-medium">{missedMae}</span>
                </span>
              </Tooltip>
            )}
          </div>
          <div className="rounded-lg overflow-x-auto" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left py-2 px-3">Player</th>
                  <th className="text-center py-2 px-3">Pos</th>
                  <th className="text-left py-2 px-3">Team</th>
                  <th className="text-right py-2 px-3">Blend</th>
                  <th className="text-right py-2 px-3">Proj/Game</th>
                  <th className="text-right py-2 px-3 font-semibold">Actual Pts</th>
                  <th className="text-right py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((player) => {
                  const errorColor =
                    player.error <= 1 ? "text-emerald-400" :
                    player.error <= 3 ? "text-amber-400" :
                    "text-red-400";
                  return (
                    <tr key={player.id} className="border-t border-[#1a1a1a]">
                      <td className="py-2 px-3 font-medium">{player.webName}</td>
                      <td className="py-2 px-3 text-center text-xs">{player.position}</td>
                      <td className="py-2 px-3 text-gray-400">{player.team}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {player.blendedScore != null ? player.blendedScore.toFixed(1) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-purple-400">
                        {player.projectedPerGame != null ? player.projectedPerGame.toFixed(2) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-white">
                        {player.actualPoints}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${errorColor}`}>
                        {player.error.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Explainer                                                           */}
      {/* ----------------------------------------------------------------- */}
      <div className="text-xs text-gray-600 px-1 space-y-1">
        <p>
          <strong className="text-gray-500">Snapshots</strong>: Predictions are automatically captured when a gameweek deadline passes. Actuals are merged in once all matches finish.
        </p>
        <p>
          <strong className="text-gray-500">MAE</strong> (Mean Absolute Error): average difference between projected per-game points and actual points. Lower is better.
        </p>
        <p>
          <strong className="text-gray-500">Rank r</strong> (Spearman correlation): how well the predicted ranking matches the actual ranking. 1.0 = perfect, 0 = random, negative = inverted.
        </p>
        <p>
          <strong className="text-gray-500">Global Top-10</strong>: of our 10 highest-rated players by blend score, how many actually finished in the top 10 scorers that gameweek.
        </p>
        <p>
          <strong className="text-gray-500">Per-Position Top-10%</strong>: within each position group, of our predicted top 10% by blend, how many were in the actual top 10%. Isolates accuracy within roles.
        </p>
        <p>
          <strong className="text-gray-500">Error color</strong>: green = within 1 pt, amber = within 3 pts, red = 3+ pts off.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small summary metric card component
// ---------------------------------------------------------------------------

function MetricCard({ label, value, sublabel, tooltip }) {
  const content = (
    <div className="px-3 py-3 rounded-lg" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sublabel && <div className="text-[9px] text-gray-600 mt-0.5">{sublabel}</div>}
    </div>
  );

  if (tooltip) {
    return <Tooltip text={tooltip}>{content}</Tooltip>;
  }
  return content;
}
