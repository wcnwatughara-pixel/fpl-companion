/**
 * BestGW.jsx -- Best Team for Next Gameweek
 *
 * Feature 8: Shows the optimal starting XI for the upcoming gameweek.
 *
 * Two views:
 * 1. "My Squad" -- picks the best XI from the user's current 15-man squad
 * 2. "All Players" -- picks the best XI from the entire player population
 *    (unconstrained by ownership, useful for Free Hit / benchmarking)
 *
 * Uses selectBestXI with configurable sort key (composite, projected, blend).
 * For "All Players" view, builds a best-possible 15-man squad first (top by
 * the chosen metric per position, respecting max 3 per team), then runs
 * selectBestXI on that squad.
 *
 * The page shows:
 * - Formation and total score
 * - Starting XI table with key stats
 * - Bench table
 * - Captain recommendation (top player by captaincy score)
 */

import { useState, useMemo } from "react";
import { useFpl } from "../context/FplContext.jsx";
import {
  selectBestXI,
  calculateCaptaincyScores,
} from "../utils/scoring.js";
import { FixtureMiniRow } from "../components/FixtureGrid.jsx";
import ScoreBar from "../components/ScoreBar.jsx";
import { formatPrice, formatDecimal } from "../utils/formatters.js";

/** FPL squad constraints */
const POSITION_LIMITS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_TEAM = 3;
const SQUAD_SIZE = 15;

/**
 * Sort mode options -- which metric drives XI selection.
 */
const SORT_MODES = [
  { value: "composite", label: "Composite" },
  { value: "projected", label: "Projected Pts" },
  { value: "blend", label: "Blend" },
];

/**
 * Formation options for the dropdown.
 * null = auto-select (test all 7 and pick best).
 * Array = lock to that specific DEF-MID-FWD split.
 */
const FORMATION_OPTIONS = [
  { label: "Auto (best)", value: null },
  { label: "3-4-3", value: [3, 4, 3] },
  { label: "3-5-2", value: [3, 5, 2] },
  { label: "4-3-3", value: [4, 3, 3] },
  { label: "4-4-2", value: [4, 4, 2] },
  { label: "4-5-1", value: [4, 5, 1] },
  { label: "5-3-2", value: [5, 3, 2] },
  { label: "5-4-1", value: [5, 4, 1] },
];

export default function BestGW() {
  // Use planningGw for the title and recommendations since Best XI
  // is a forward-looking feature (which players to start NEXT week).
  const { players, picks, loading, planningGw } = useFpl();

  const [view, setView] = useState("squad"); // "squad" or "all"
  const [sortMode, setSortMode] = useState("blend");
  // null = auto-select best formation; [4,3,3] etc = locked formation
  const [selectedFormation, setSelectedFormation] = useState(null);

  // IDs of players in the user's current squad
  const squadIds = useMemo(() => {
    if (!picks?.picks) return new Set();
    return new Set(picks.picks.map((p) => p.element));
  }, [picks]);

  // Squad players with data
  const squadPlayers = useMemo(() => {
    if (!squadIds.size) return [];
    return players.filter((p) => squadIds.has(p.id));
  }, [players, squadIds]);

  /**
   * Build a "dream team" 15-man squad from all players.
   * Respects FPL constraints: position limits + max 3 per team.
   * Picks the top players by the chosen metric greedily.
   */
  const dreamSquad = useMemo(() => {
    if (view !== "all" || !players.length) return [];

    // Prepare pool: only players with 45+ minutes
    // Blend scores are already computed globally in FplContext
    let pool = players.filter((p) => p.minutes >= 45);

    const key =
      sortMode === "projected" ? "projectedPoints" :
      sortMode === "blend" ? "blendedScore" :
      "compositeScore";

    // Sort all by chosen metric, best first
    const sorted = [...pool].sort((a, b) => (b[key] || 0) - (a[key] || 0));

    // Greedy pick respecting constraints
    const squad = [];
    const posCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const teamCounts = {};

    for (const p of sorted) {
      if (squad.length >= SQUAD_SIZE) break;

      const pos = p.position_name;
      if (posCounts[pos] >= POSITION_LIMITS[pos]) continue;

      const teamCount = teamCounts[p.team] || 0;
      if (teamCount >= MAX_PER_TEAM) continue;

      posCounts[pos]++;
      teamCounts[p.team] = teamCount + 1;
      squad.push(p);
    }

    return squad;
  }, [players, view, sortMode]);

  /**
   * Run selectBestXI on the chosen pool.
   */
  const { formation, startingXI, bench, totalScore } = useMemo(() => {
    const pool = view === "squad" ? squadPlayers : dreamSquad;
    if (!pool.length) return { formation: "---", startingXI: [], bench: [], totalScore: 0 };

    // Blend scores are already computed globally in FplContext
    const key =
      sortMode === "projected" ? "projectedPoints" :
      sortMode === "blend" ? "blendedScore" :
      "compositeScore";

    // Pass the locked formation (null = auto-select best)
    return selectBestXI(pool, key, selectedFormation);
  }, [view, squadPlayers, dreamSquad, sortMode, selectedFormation]);

  /**
   * Captain pick: top player from the XI by captaincy score.
   */
  const captainPick = useMemo(() => {
    if (!startingXI.length) return null;

    const xiIds = new Set(startingXI.map((p) => p.id));
    const { captains } = calculateCaptaincyScores(
      players.filter((p) => xiIds.has(p.id)),
      { squadOnly: false },
      xiIds
    );

    return captains[0] || null;
  }, [startingXI, players]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  const sortKey =
    sortMode === "projected" ? "projectedPoints" :
    sortMode === "blend" ? "blendedScore" :
    "compositeScore";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">
        Best XI for GW{planningGw ? planningGw : "?"}
      </h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* View toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("squad")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "squad"
                ? "bg-[#333] text-white"
                : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
            }`}
          >
            My Squad
          </button>
          <button
            onClick={() => setView("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "all"
                ? "bg-[#333] text-white"
                : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
            }`}
          >
            All Players
          </button>
        </div>

        {/* Sort mode */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Optimize By</label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Formation selector: Auto tests all 7 and picks the best;
            selecting a specific formation locks the XI to that shape */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Formation</label>
          <select
            value={selectedFormation ? selectedFormation.join("-") : "auto"}
            onChange={(e) => {
              if (e.target.value === "auto") {
                setSelectedFormation(null);
              } else {
                setSelectedFormation(e.target.value.split("-").map(Number));
              }
            }}
            className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
          >
            {FORMATION_OPTIONS.map((opt) => (
              <option
                key={opt.label}
                value={opt.value ? opt.value.join("-") : "auto"}
              >
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Formation + total score summary */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-lg" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <div>
          <div className="text-xs text-gray-500">Formation</div>
          <div className="text-lg font-bold">{formation}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Total {sortMode === "projected" ? "Proj Pts" : "Score"}</div>
          <div className="text-lg font-bold text-purple-400 tabular-nums">
            {sortMode === "projected" ? totalScore.toFixed(1) : totalScore}
          </div>
        </div>
        {captainPick && (
          <div className="ml-auto text-right">
            <div className="text-xs text-gray-500">Recommended Captain</div>
            <div className="text-sm font-semibold text-amber-400">
              {captainPick.web_name}
              <span className="ml-1 text-[10px] text-gray-500">({captainPick.team_name})</span>
            </div>
          </div>
        )}
      </div>

      {/* Starting XI table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Starting XI</h2>
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="text-left py-2 px-3">Player</th>
                <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                <th className="text-center py-2 px-3">Pos</th>
                <th className="text-right py-2 px-3">Price</th>
                <th className="text-right py-2 px-3">Form</th>
                <th className="py-2 px-3 min-w-[100px]">Score</th>
                <th className="text-right py-2 px-3">Proj Pts</th>
                <th className="py-2 px-3 hidden lg:table-cell">Next 5</th>
              </tr>
            </thead>
            <tbody>
              {startingXI.map((player) => (
                <tr key={player.id} className="border-t border-[#1a1a1a] hover:bg-[#1a1a1a]">
                  <td className="py-2 px-3 font-medium">
                    {player.web_name}
                    {captainPick?.id === player.id && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        C
                      </span>
                    )}
                    {player.chance_of_playing < 100 && (
                      <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
                        {player.chance_of_playing}%
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-400 hidden md:table-cell">{player.team_name}</td>
                  <td className="py-2 px-3 text-center">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{
                      backgroundColor:
                        player.position_name === "GKP" ? "#f59e0b" :
                        player.position_name === "DEF" ? "#22c55e" :
                        player.position_name === "MID" ? "#3b82f6" : "#ef4444",
                      color: "#000",
                    }}>
                      {player.position_name}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatPrice(player.price)}m</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatDecimal(player.form_num)}</td>
                  <td className="py-2 px-3">
                    <ScoreBar score={player[sortKey] || 0} />
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium text-purple-400">
                    {player.projectedPoints?.toFixed(1) ?? "-"}
                  </td>
                  <td className="py-2 px-3 hidden lg:table-cell">
                    <FixtureMiniRow fixtures={player.upcoming_fixtures?.slice(0, 5)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bench */}
      {bench.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Bench</h2>
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left py-2 px-3">Player</th>
                  <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                  <th className="text-center py-2 px-3">Pos</th>
                  <th className="text-right py-2 px-3">Price</th>
                  <th className="py-2 px-3 min-w-[100px]">Score</th>
                  <th className="text-right py-2 px-3">Proj Pts</th>
                </tr>
              </thead>
              <tbody>
                {bench.map((player) => (
                  <tr key={player.id} className="border-t border-[#1a1a1a] opacity-60">
                    <td className="py-2 px-3 font-medium">{player.web_name}</td>
                    <td className="py-2 px-3 text-gray-400 hidden md:table-cell">{player.team_name}</td>
                    <td className="py-2 px-3 text-center text-xs">{player.position_name}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatPrice(player.price)}m</td>
                    <td className="py-2 px-3">
                      <ScoreBar score={player[sortKey] || 0} />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium text-purple-400">
                      {player.projectedPoints?.toFixed(1) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Explainer */}
      <div className="text-xs text-gray-600 px-1 space-y-1">
        <p>
          <strong className="text-gray-500">My Squad</strong> picks the best starting XI from your current 15-man FPL squad.
        </p>
        <p>
          <strong className="text-gray-500">All Players</strong> builds an unconstrained dream team from every available player (respecting max 3 per club), useful for Free Hit planning or benchmarking your squad.
        </p>
        <p>
          <strong className="text-gray-500">Optimize By</strong> controls which metric drives player selection: Composite (multi-factor relative rank), Projected Pts (absolute point estimate), or Blend (50/50 mix of both).
        </p>
      </div>
    </div>
  );
}
