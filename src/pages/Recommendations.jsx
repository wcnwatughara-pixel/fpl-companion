/**
 * Recommendations.jsx -- Transfer & Captaincy Recommendations
 *
 * Two tabs:
 * 1. Transfers: "Best Players to Buy" (top picks by composite score) and
 *    "Consider Selling" (squad players with low scores).
 *    Toggle: "All players" vs "Exclude my team" for Best Buy list.
 *    Players already in squad get an "In squad" badge.
 *
 * 2. Captaincy: Captain and vice-captain picks for the upcoming GW.
 *    Toggle: "My squad" vs "All players" for captain pool.
 *    Vice-captain list is purely on merit (independent of captain choice).
 *
 * Feature 4: "Suggested Replacement" column in Consider Selling table.
 *            For each selling candidate, shows the best available player
 *            in the same position (not in squad, 45+ mins, affordable at
 *            selling player's price + 0.5m buffer), ranked by blend score.
 *
 * Everything is driven by the composite and captaincy scoring algorithms.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFpl } from "../context/FplContext.jsx";
import { calculateCaptaincyScores, calculateBlendedScores } from "../utils/scoring.js";
import { buildUpcomingFixtures } from "../utils/transforms.js";
import { findBestPairings, findPlayerPairings, findMultiPositionPairings } from "../utils/fixturePairings.js";
import { fdrBg, fdrText } from "../utils/fdrColors.js";
import { FixtureMiniRow } from "../components/FixtureGrid.jsx";
import ScoreBar from "../components/ScoreBar.jsx";
import { formatPrice, formatDecimal } from "../utils/formatters.js";
import Tooltip from "../components/Tooltip.jsx";
import { getMetric } from "../data/metricDefinitions.js";

/**
 * Available gameweek horizon options for the projected points selector.
 * Users can project over 1 to 10 upcoming gameweeks.
 */
const HORIZON_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10];

/**
 * Sort mode options for the transfer recommendations.
 * Controls which metric drives the ranking in Best Buy / Consider Selling.
 *
 * - composite:  rank by composite score (multi-factor relative rank, 0-100)
 * - projected:  rank by projected points (absolute FPL point estimate)
 * - blend:      rank by 50/50 normalised mix of composite and projected
 */
const SORT_MODES = [
  { value: "composite", label: "Composite" },
  { value: "projected", label: "Projected" },
  { value: "blend",     label: "Blend" },
];

/**
 * Sort mode options for the captaincy tab.
 * Adds the dedicated captaincy formula as an option alongside the three
 * standard sort modes. The captaincy formula is single-GW focused with
 * aggressive injury penalties, making it ideal for captain selection.
 *
 * - captaincy:  dedicated single-GW captaincy formula (35% next FDR,
 *               25% form, 20% xGI/90, 10% ICT, 10% pts/90)
 * - composite:  rank by composite score
 * - projected:  rank by projected per-game points
 * - blend:      50/50 normalised mix of composite and projected
 */
const CAPTAINCY_SORT_MODES = [
  { value: "captaincy", label: "Cap Score" },
  { value: "composite", label: "Composite" },
  { value: "projected", label: "Projected" },
  { value: "blend",     label: "Blend" },
];

export default function Recommendations() {
  const { players, picks, loading, projectionHorizon, setProjectionHorizon, fixtures, teamsById, planningGw } = useFpl();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("transfers"); // "transfers" | "captaincy" | "pairings"
  const [positionFilter, setPositionFilter] = useState("All");

  // Sort mode for transfers tab: "composite", "projected", or "blend"
  const [transferSortMode, setTransferSortMode] = useState("composite");

  // Sort mode for captaincy tab: "captaincy", "composite", "projected", or "blend"
  const [captainSortMode, setCaptainSortMode] = useState("captaincy");

  // Dynamic price slider: max = most expensive player rounded up to nearest 0.5m.
  // This ensures players like Haaland (15m+) always appear in results.
  // We default maxPriceFilter to Infinity so the slider starts at the ceiling;
  // the effective max is clamped to maxPlayerPrice in the slider's max prop.
  const maxPlayerPrice = useMemo(() => {
    if (!players.length) return 16;
    const highest = Math.max(...players.map((p) => p.price));
    return Math.ceil(highest * 2) / 2; // round up to nearest 0.5
  }, [players]);
  const [maxPriceFilter, setMaxPriceFilter] = useState(999);
  // The actual filter value used for comparison: clamped to maxPlayerPrice
  const effectiveMaxPrice = Math.min(maxPriceFilter, maxPlayerPrice);

  // Toggle: show all players or exclude squad in the Best Buy list
  const [showAllInBestBuy, setShowAllInBestBuy] = useState(false);

  // Toggle: show captaincy from all players or just squad
  const [captaincyFromAll, setCaptaincyFromAll] = useState(false);

  // Pairings tab state
  // Multi-select: user can pick one or two positions at once
  const [pairingPositions, setPairingPositions] = useState(new Set(["GKP"]));

  /**
   * Toggle a position in the multi-select set.
   * Allows 1-2 simultaneous selections. If clicking an already-selected
   * position and it's the only one, do nothing (must have at least one).
   * If clicking a third, drop the oldest (first in iteration order).
   */
  const togglePairingPosition = (pos) => {
    setPairingPositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) {
        // Don't allow deselecting the last one
        if (next.size > 1) next.delete(pos);
      } else if (next.size < 2) {
        next.add(pos);
      } else {
        // Already 2 selected: drop the first, add the new one
        const first = next.values().next().value;
        next.delete(first);
        next.add(pos);
      }
      return next;
    });
  };
  const [pairingHorizon, setPairingHorizon] = useState(5);
  const [pairingSortMode, setPairingSortMode] = useState("blend");
  // Price filters: null = no cap (show all)
  const [pairingMaxCombined, setPairingMaxCombined] = useState(null);
  const [pairingMaxIndividual, setPairingMaxIndividual] = useState(null);
  // Custom team pair mode: "auto" ranks all pairs, "custom" filters to a specific two-team pair
  const [pairingTeamMode, setPairingTeamMode] = useState("auto");
  const [pairingTeamA, setPairingTeamA] = useState(null);
  const [pairingTeamB, setPairingTeamB] = useState(null);

  // IDs of players in the user's current squad
  const squadIds = useMemo(() => {
    if (!picks?.picks) return new Set();
    return new Set(picks.picks.map((p) => p.element));
  }, [picks]);

  /**
   * Sort comparator factory based on the chosen sort mode.
   * Returns a descending comparator for "best first" or ascending for "worst first".
   *
   * For blend mode we need to calculate blended scores first, so the
   * bestIn and considerSelling memos do that inline.
   */
  function getSortKey(mode) {
    if (mode === "projected") return "projectedPoints";
    if (mode === "blend") return "blendedScore";
    return "compositeScore"; // default / composite
  }

  // "Best Players to Buy": sorted by the selected metric.
  // When "All players" toggle is on, includes squad players with a badge.
  // When off, filters them out (original behaviour).
  const bestIn = useMemo(() => {
    let pool = players
      .filter((p) => showAllInBestBuy || !squadIds.has(p.id))
      .filter((p) => positionFilter === "All" || p.position_name === positionFilter)
      .filter((p) => p.price <= effectiveMaxPrice)
      .filter((p) => p.minutes >= 45); // only players who actually play

    // Calculate blended scores within this filtered pool so normalisation
    // is relative to the visible players (not the entire dataset)
    if (transferSortMode === "blend") {
      pool = calculateBlendedScores(pool);
    }

    const key = getSortKey(transferSortMode);
    return pool
      .sort((a, b) => (b[key] || 0) - (a[key] || 0))
      .slice(0, 20);
  }, [players, squadIds, positionFilter, effectiveMaxPrice, showAllInBestBuy, transferSortMode]);

  // "Consider Selling": squad players ranked worst-first by the selected metric.
  const considerSelling = useMemo(() => {
    let pool = players.filter((p) => squadIds.has(p.id));

    if (transferSortMode === "blend") {
      pool = calculateBlendedScores(pool);
    }

    const key = getSortKey(transferSortMode);
    return pool
      .sort((a, b) => (a[key] || 0) - (b[key] || 0))
      .slice(0, 5);
  }, [players, squadIds, transferSortMode]);

  /**
   * Feature 4: Replacement recommendations for Consider Selling players.
   *
   * For each player in considerSelling, find the best available replacement:
   * - Same position
   * - Not already in the user's squad
   * - Has played 45+ minutes (viable pick)
   * - Affordable at selling player's price + 0.5m transfer budget buffer
   * - Ranked by blended score (50/50 composite + projected)
   *
   * Returns a Map<playerId, replacementPlayer> for quick lookup.
   */
  const replacements = useMemo(() => {
    if (!considerSelling.length || !players.length) return new Map();

    // Build pool of all non-squad players with 45+ minutes, with blend scores
    const availablePool = calculateBlendedScores(
      players.filter((p) => !squadIds.has(p.id) && p.minutes >= 45)
    );

    const map = new Map();

    for (const selling of considerSelling) {
      const budget = selling.price + 0.5; // 0.5m buffer from selling price
      const best = availablePool
        .filter((p) => p.position_name === selling.position_name)
        .filter((p) => p.price <= budget)
        .sort((a, b) => (b.blendedScore || 0) - (a.blendedScore || 0))[0];

      if (best) {
        map.set(selling.id, best);
      }
    }

    return map;
  }, [considerSelling, players, squadIds]);

  // Captaincy picks -- supports 4 sort modes:
  //   "captaincy": dedicated single-GW formula (original behavior)
  //   "composite": rank by composite score
  //   "projected": rank by projected per-game points
  //   "blend":     50/50 normalised mix of composite and projected
  const { captainPicks, viceCaptainPicks } = useMemo(() => {
    if (captainSortMode === "captaincy") {
      // Use the dedicated captaincy scoring formula
      const result = calculateCaptaincyScores(
        players,
        { squadOnly: !captaincyFromAll },
        squadIds
      );
      return {
        captainPicks: result.captains,
        viceCaptainPicks: result.viceCaptains,
      };
    }

    // For composite / projected / blend: filter the pool then sort
    let pool = players
      .filter((p) => !captaincyFromAll ? (squadIds.size > 0 ? squadIds.has(p.id) : true) : true)
      .filter((p) => p.minutes >= 90); // captains must actually play

    if (captainSortMode === "blend") {
      pool = calculateBlendedScores(pool);
    }

    const key = captainSortMode === "projected" ? "projectedPerGame"
              : captainSortMode === "blend"     ? "blendedScore"
              :                                   "compositeScore";

    const sorted = pool
      .map((p) => ({
        ...p,
        // Attach inSquad flag and next fixture for display consistency
        inSquad: squadIds.size > 0 ? squadIds.has(p.id) : true,
        nextFixture: p.upcoming_fixtures?.[0] || null,
      }))
      .sort((a, b) => (b[key] || 0) - (a[key] || 0));

    return {
      captainPicks: sorted.slice(0, 10),
      viceCaptainPicks: sorted.slice(0, 10),
    };
  }, [players, squadIds, captaincyFromAll, captainSortMode]);

  // ---------------------------------------------------------------------------
  // Fixture pairings: find team pairs then recommend specific players
  // ---------------------------------------------------------------------------

  // Build upcoming fixtures for the pairing horizon
  const pairingUpcoming = useMemo(() => {
    if (!fixtures?.length || !teamsById || !planningGw) return {};
    return buildUpcomingFixtures(fixtures, teamsById, planningGw, pairingHorizon);
  }, [fixtures, teamsById, planningGw, pairingHorizon]);

  const pairingGwRange = useMemo(() => {
    if (!planningGw) return [];
    return Array.from({ length: pairingHorizon }, (_, i) => planningGw + i);
  }, [planningGw, pairingHorizon]);

  // Find best alternating team pairs
  const teamPairings = useMemo(() => {
    if (!pairingUpcoming || !Object.keys(pairingUpcoming).length) return [];
    return findBestPairings(pairingUpcoming, teamsById, pairingGwRange);
  }, [pairingUpcoming, teamsById, pairingGwRange]);

  // When in custom mode, filter team pairings to only the user-selected pair.
  // In auto mode, pass all team pairings through unchanged.
  const effectiveTeamPairings = useMemo(() => {
    if (pairingTeamMode === "auto" || !pairingTeamA || !pairingTeamB) return teamPairings;

    // Find the specific pair (order doesn't matter: A-B or B-A)
    return teamPairings.filter((p) =>
      (p.teamA.id === pairingTeamA && p.teamB.id === pairingTeamB) ||
      (p.teamA.id === pairingTeamB && p.teamB.id === pairingTeamA)
    );
  }, [teamPairings, pairingTeamMode, pairingTeamA, pairingTeamB]);

  // Find player-level pairings for the selected position(s).
  // Single position: same-position pairs (MID + MID on alternating teams).
  // Two positions: cross-position pairs (MID from team A + FWD from team B),
  // so each player fills a different role and you rotate between them.
  const playerPairings = useMemo(() => {
    if (!effectiveTeamPairings.length || !players.length || !pairingPositions.size) return [];

    const sortKey =
      pairingSortMode === "projected" ? "projectedPoints" :
      pairingSortMode === "blend" ? "blendedScore" :
      "compositeScore";

    const posArray = [...pairingPositions];

    if (posArray.length === 1) {
      // Single position: two players of the same position
      return findPlayerPairings(effectiveTeamPairings, players, posArray[0], sortKey, 10);
    }

    // Two positions: one player from each position across alternating teams
    return findMultiPositionPairings(effectiveTeamPairings, players, posArray, sortKey, 10);
  }, [effectiveTeamPairings, players, pairingPositions, pairingSortMode]);

  // Apply price filters on top of the raw player pairings.
  // Kept as a separate memo so changing a price slider doesn't
  // re-run the heavier pairing algorithm.
  const filteredPairings = useMemo(() => {
    let results = playerPairings;

    if (pairingMaxIndividual !== null) {
      results = results.filter(
        (p) => p.playerA.price <= pairingMaxIndividual && p.playerB.price <= pairingMaxIndividual
      );
    }
    if (pairingMaxCombined !== null) {
      results = results.filter((p) => p.combinedPrice <= pairingMaxCombined);
    }

    return results;
  }, [playerPairings, pairingMaxCombined, pairingMaxIndividual]);

  /**
   * Navigate to Compare page with a player pre-selected.
   */
  const handleCompare = (playerId) => {
    navigate(`/compare?player=${playerId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading recommendations...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Recommendations</h1>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab("transfers")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "transfers"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          Transfers
        </button>
        <button
          onClick={() => setActiveTab("captaincy")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "captaincy"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          Captaincy
        </button>
        <button
          onClick={() => setActiveTab("pairings")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "pairings"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          Pairings
        </button>
      </div>

      {/* Transfers tab */}
      {activeTab === "transfers" && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position</label>
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
              >
                <option value="All">All</option>
                <option value="GKP">GKP</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Max Price: {effectiveMaxPrice.toFixed(1)}m
              </label>
              <input
                type="range"
                min="3.5"
                max={maxPlayerPrice}
                step="0.5"
                value={effectiveMaxPrice}
                onChange={(e) => setMaxPriceFilter(parseFloat(e.target.value))}
                className="w-32"
              />
            </div>
            {/* Sort mode: which metric drives the ranking */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                <Tooltip text={getMetric("sortMode").short}>Sort By</Tooltip>
              </label>
              <select
                value={transferSortMode}
                onChange={(e) => setTransferSortMode(e.target.value)}
                className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
              >
                {SORT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            {/* Projection horizon selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                <Tooltip text={getMetric("projHorizon").short}>Proj GWs</Tooltip>
              </label>
              <select
                value={projectionHorizon}
                onChange={(e) => setProjectionHorizon(Number(e.target.value))}
                className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
              >
                {HORIZON_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} GW{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
            {/* Toggle: All players vs Exclude my team */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setShowAllInBestBuy(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !showAllInBestBuy
                    ? "bg-[#333] text-white"
                    : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
                }`}
              >
                Exclude my team
              </button>
              <button
                onClick={() => setShowAllInBestBuy(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  showAllInBestBuy
                    ? "bg-[#333] text-white"
                    : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
                }`}
              >
                All players
              </button>
            </div>
          </div>

          {/* Best Players to Buy */}
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Best Players to Buy</h2>
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400">
                    <th className="text-left py-2 px-3">#</th>
                    <th className="text-left py-2 px-3">Player</th>
                    <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                    <th className="text-center py-2 px-3">Pos</th>
                    <th className="text-right py-2 px-3">
                      <Tooltip text={getMetric("price").short}>Price</Tooltip>
                    </th>
                    <th className="py-2 px-3 min-w-[120px]">
                      <Tooltip text={getMetric(
                        transferSortMode === "projected" ? "projectedPoints" :
                        transferSortMode === "blend"     ? "blendedScore" : "compositeScore"
                      ).short}>
                        {transferSortMode === "projected" ? "Proj/Game" :
                         transferSortMode === "blend"     ? "Blend" : "Score"}
                      </Tooltip>
                    </th>
                    <th className="text-right py-2 px-3">
                      <Tooltip text={getMetric("projectedPoints").short}>Proj Pts</Tooltip>
                    </th>
                    <th className="py-2 px-3 hidden lg:table-cell">
                      <Tooltip text={getMetric("next5Fixtures").short}>Next 5</Tooltip>
                    </th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {bestIn.map((player, i) => {
                    const transferDisplayScore =
                      transferSortMode === "projected" ? (player.projectedPerGame || 0) :
                      transferSortMode === "blend"     ? (player.blendedScore || 0) :
                                                          (player.compositeScore || 0);
                    const transferIsBar = transferSortMode !== "projected";
                    return (
                    <tr key={player.id} className="border-t border-[#1a1a1a] hover:bg-[#1a1a1a]">
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{i + 1}</td>
                      <td className="py-2 px-3 font-medium">
                        {player.web_name}
                        {/* "In squad" badge when showing all players */}
                        {showAllInBestBuy && squadIds.has(player.id) && (
                          <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            IN SQUAD
                          </span>
                        )}
                        {/* Injury/availability indicator */}
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
                      <td className="py-2 px-3">
                        {transferIsBar
                          ? <ScoreBar score={transferDisplayScore} />
                          : <span className="tabular-nums font-medium text-purple-400">{transferDisplayScore.toFixed(1)}</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium text-purple-400">
                        {player.projectedPoints?.toFixed(1) ?? "-"}
                      </td>
                      <td className="py-2 px-3 hidden lg:table-cell">
                        <FixtureMiniRow fixtures={player.upcoming_fixtures?.slice(0, 5)} />
                      </td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => handleCompare(player.id)}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          Compare
                        </button>
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Consider Selling (with Feature 4: Suggested Replacement column) */}
          {considerSelling.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Consider Selling</h2>
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="text-left py-2 px-3">Player</th>
                      <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                      <th className="text-center py-2 px-3">Pos</th>
                      <th className="text-right py-2 px-3">
                        <Tooltip text={getMetric("price").short}>Price</Tooltip>
                      </th>
                      <th className="py-2 px-3 min-w-[120px]">
                        <Tooltip text={getMetric(
                          transferSortMode === "projected" ? "projectedPoints" :
                          transferSortMode === "blend"     ? "blendedScore" : "compositeScore"
                        ).short}>
                          {transferSortMode === "projected" ? "Proj/Game" :
                           transferSortMode === "blend"     ? "Blend" : "Score"}
                        </Tooltip>
                      </th>
                      <th className="text-right py-2 px-3">
                        <Tooltip text={getMetric("projectedPoints").short}>Proj Pts</Tooltip>
                      </th>
                      <th className="text-left py-2 px-3 hidden lg:table-cell" title="Best available replacement in the same position, affordable with sale proceeds + 0.5m buffer">
                        <Tooltip text="Best available player in the same position you can afford after selling this player (price + 0.5m buffer), ranked by blend score">
                          Suggested Replacement
                        </Tooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {considerSelling.map((player) => {
                      const replacement = replacements.get(player.id);
                      const sellDisplayScore =
                        transferSortMode === "projected" ? (player.projectedPerGame || 0) :
                        transferSortMode === "blend"     ? (player.blendedScore || 0) :
                                                            (player.compositeScore || 0);
                      const sellIsBar = transferSortMode !== "projected";
                      return (
                        <tr key={player.id} className="border-t border-[#1a1a1a]">
                          <td className="py-2 px-3 font-medium">
                            {player.web_name}
                            {player.chance_of_playing < 100 && (
                              <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
                                {player.chance_of_playing}%
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-400 hidden md:table-cell">{player.team_name}</td>
                          <td className="py-2 px-3 text-center text-xs">{player.position_name}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatPrice(player.price)}m</td>
                          <td className="py-2 px-3">
                            {sellIsBar
                              ? <ScoreBar score={sellDisplayScore} />
                              : <span className="tabular-nums font-medium text-purple-400">{sellDisplayScore.toFixed(1)}</span>
                            }
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-medium text-purple-400">
                            {player.projectedPoints?.toFixed(1) ?? "-"}
                          </td>
                          {/* Feature 4: Suggested Replacement */}
                          <td className="py-2 px-3 hidden lg:table-cell">
                            {replacement ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleCompare(replacement.id)}
                                  className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                                  title="Compare this replacement"
                                >
                                  {replacement.web_name}
                                </button>
                                <span className="text-[10px] text-gray-500">{replacement.team_name}</span>
                                <span className="text-[10px] text-gray-400 tabular-nums">
                                  {formatPrice(replacement.price)}m
                                </span>
                                <span className="text-[10px] text-cyan-400 tabular-nums" title="Blend Score">
                                  {formatDecimal(replacement.blendedScore || 0)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-600">No replacement found</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Captaincy tab */}
      {activeTab === "captaincy" && (
        <div className="space-y-6">
          {/* Captaincy controls: sort mode + squad toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Sort mode selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                <Tooltip text={getMetric("sortMode").short}>Rank By</Tooltip>
              </label>
              <select
                value={captainSortMode}
                onChange={(e) => setCaptainSortMode(e.target.value)}
                className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
              >
                {CAPTAINCY_SORT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            {/* Squad toggle */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setCaptaincyFromAll(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !captaincyFromAll
                    ? "bg-[#333] text-white"
                    : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
                }`}
              >
                My squad
              </button>
              <button
                onClick={() => setCaptaincyFromAll(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  captaincyFromAll
                    ? "bg-[#333] text-white"
                    : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
                }`}
              >
                All players
              </button>
            </div>
          </div>

          {/* Captain picks */}
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Top Captain Picks
            </h2>
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400">
                    <th className="text-left py-2 px-3">#</th>
                    <th className="text-left py-2 px-3">Player</th>
                    <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                    <th className="text-center py-2 px-3">Next Fixture</th>
                    <th className="text-right py-2 px-3">
                      <Tooltip text={getMetric("form").short}>Form</Tooltip>
                    </th>
                    <th className="text-right py-2 px-3">
                      <Tooltip text={getMetric("xgiPer90").short}>xGI/90</Tooltip>
                    </th>
                    <th className="py-2 px-3 min-w-[100px]">
                      <Tooltip text={getMetric(
                        captainSortMode === "captaincy" ? "captaincyScore" :
                        captainSortMode === "projected" ? "projectedPerGame" :
                        captainSortMode === "blend"     ? "blendedScore" : "compositeScore"
                      ).short}>
                        {captainSortMode === "captaincy" ? "Cap Score" :
                         captainSortMode === "projected" ? "Proj/Game" :
                         captainSortMode === "blend"     ? "Blend" : "Composite"}
                      </Tooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {captainPicks.map((player, i) => {
                    // Pick the right score to display based on the selected mode
                    const displayScore =
                      captainSortMode === "captaincy" ? (player.captaincyScore || 0) :
                      captainSortMode === "projected" ? (player.projectedPerGame || 0) :
                      captainSortMode === "blend"     ? (player.blendedScore || 0) :
                                                        (player.compositeScore || 0);
                    // Use ScoreBar for 0-100 metrics, plain number for projected
                    const isBarMetric = captainSortMode !== "projected";

                    return (
                    <tr key={player.id} className="border-t border-[#1a1a1a]">
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{i + 1}</td>
                      <td className="py-2 px-3 font-medium">
                        {player.web_name}
                        {/* Show "In squad" badge when viewing all players */}
                        {captaincyFromAll && player.inSquad && (
                          <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            IN SQUAD
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
                        {player.nextFixture && (
                          <FixtureMiniRow fixtures={[player.nextFixture]} />
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatDecimal(player.form_num)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatDecimal(player.xgi_per_90)}</td>
                      <td className="py-2 px-3">
                        {isBarMetric ? (
                          <ScoreBar score={displayScore} />
                        ) : (
                          <span className="text-purple-400 font-medium tabular-nums">
                            {displayScore.toFixed(1)}
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Vice-captain picks -- purely on merit */}
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Vice-Captain Picks
              <span className="ml-2 text-xs font-normal text-gray-500">
                Ranked on merit -- the armband passes if captain doesn't play
              </span>
            </h2>
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400">
                    <th className="text-left py-2 px-3">#</th>
                    <th className="text-left py-2 px-3">Player</th>
                    <th className="text-left py-2 px-3 hidden md:table-cell">Team</th>
                    <th className="text-center py-2 px-3">Next Fixture</th>
                    <th className="text-right py-2 px-3">
                      <Tooltip text={getMetric("form").short}>Form</Tooltip>
                    </th>
                    <th className="py-2 px-3 min-w-[100px]">
                      <Tooltip text={getMetric("vcScore").short}>VC Score</Tooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {viceCaptainPicks.slice(0, 5).map((player, i) => (
                    <tr key={player.id} className="border-t border-[#1a1a1a]">
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{i + 1}</td>
                      <td className="py-2 px-3 font-medium">
                        {player.web_name}
                        {captaincyFromAll && player.inSquad && (
                          <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            IN SQUAD
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-gray-400 hidden md:table-cell">{player.team_name}</td>
                      <td className="py-2 px-3 text-center">
                        {player.nextFixture && (
                          <FixtureMiniRow fixtures={[player.nextFixture]} />
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatDecimal(player.form_num)}</td>
                      <td className="py-2 px-3">
                        <ScoreBar score={player.captaincyScore || 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* PAIRINGS TAB                                                       */}
      {/* Player-level fixture alternating pairs: pick two players whose     */}
      {/* teams alternate easy/hard fixtures so you always have a starter    */}
      {/* on a green run.                                                    */}
      {/* ================================================================= */}
      {activeTab === "pairings" && (
        <div className="space-y-4">
          {/* Controls row: position filter, horizon, sort mode */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Position filter (multi-select, up to 2) */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Position <span className="text-gray-600">(pick 1-2)</span></span>
              <div className="flex rounded overflow-hidden border border-gray-700">
                {["GKP", "DEF", "MID", "FWD"].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => togglePairingPosition(pos)}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                      pairingPositions.has(pos)
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Horizon selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Horizon</span>
              <select
                value={pairingHorizon}
                onChange={(e) => setPairingHorizon(Number(e.target.value))}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
              >
                {[3, 5, 8, 10].map((h) => (
                  <option key={h} value={h}>{h} GWs</option>
                ))}
              </select>
            </div>

            {/* Sort mode */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Rank by</span>
              <select
                value={pairingSortMode}
                onChange={(e) => setPairingSortMode(e.target.value)}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
              >
                <option value="composite">Composite</option>
                <option value="projected">Projected</option>
                <option value="blend">Blend</option>
              </select>
            </div>

            {/* Max individual price */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Max each</span>
              <select
                value={pairingMaxIndividual ?? ""}
                onChange={(e) => setPairingMaxIndividual(e.target.value ? Number(e.target.value) : null)}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
              >
                <option value="">Any</option>
                {[5, 6, 7, 8, 9, 10, 12, 15].map((v) => (
                  <option key={v} value={v}>{v.toFixed(1)}m</option>
                ))}
              </select>
            </div>

            {/* Max combined price */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Max pair</span>
              <select
                value={pairingMaxCombined ?? ""}
                onChange={(e) => setPairingMaxCombined(e.target.value ? Number(e.target.value) : null)}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
              >
                <option value="">Any</option>
                {[10, 12, 14, 16, 18, 20, 24].map((v) => (
                  <option key={v} value={v}>{v.toFixed(1)}m</option>
                ))}
              </select>
            </div>

            {/* Auto / Custom team toggle */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const next = pairingTeamMode === "auto" ? "custom" : "auto";
                  setPairingTeamMode(next);
                  if (next === "auto") {
                    setPairingTeamA(null);
                    setPairingTeamB(null);
                  }
                }}
                className={`text-xs px-2 py-1 rounded border ${
                  pairingTeamMode === "custom"
                    ? "bg-purple-500/20 text-purple-400 border-purple-500/40"
                    : "bg-gray-800 text-gray-400 border-gray-700"
                }`}
              >
                {pairingTeamMode === "auto" ? "Auto" : "Custom"}
              </button>
            </div>

            {/* Team selectors (only in custom mode) */}
            {pairingTeamMode === "custom" && teamsById && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Team A</span>
                  <select
                    value={pairingTeamA ?? ""}
                    onChange={(e) => setPairingTeamA(e.target.value ? Number(e.target.value) : null)}
                    className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
                  >
                    <option value="">Pick...</option>
                    {Object.values(teamsById)
                      .sort((a, b) => (a.short_name || "").localeCompare(b.short_name || ""))
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.short_name}</option>
                      ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Team B</span>
                  <select
                    value={pairingTeamB ?? ""}
                    onChange={(e) => setPairingTeamB(e.target.value ? Number(e.target.value) : null)}
                    className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
                  >
                    <option value="">Pick...</option>
                    {Object.values(teamsById)
                      .sort((a, b) => (a.short_name || "").localeCompare(b.short_name || ""))
                      .filter((t) => t.id !== pairingTeamA)
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.short_name}</option>
                      ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Results */}
          {filteredPairings.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">
              {pairingTeamMode === "custom" && (!pairingTeamA || !pairingTeamB)
                ? "Pick two teams above to see their player pairings."
                : playerPairings.length > 0
                  ? "No pairs within budget. Try raising the price caps."
                  : `No player pairs found for ${[...pairingPositions].join(" / ")} position${pairingPositions.size > 1 ? "s" : ""}.`
              }
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPairings.map((pair, idx) => {
                const tp = pair.teamPairing;
                const sortLabel =
                  pairingSortMode === "projected" ? "Proj" :
                  pairingSortMode === "blend" ? "Blend" : "Comp";
                const getScore = (player) =>
                  pairingSortMode === "projected" ? player.projectedPoints :
                  pairingSortMode === "blend" ? player.blendedScore :
                  player.compositeScore;

                return (
                  <div
                    key={idx}
                    className="rounded-lg p-4 space-y-3"
                    style={{ backgroundColor: "#111", border: "1px solid #222" }}
                  >
                    {/* Header: rank + alternation score + combined price */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500 w-5">#{idx + 1}</span>
                        {/* Show combined position badge when two positions are selected */}
                        {pairingPositions.size > 1 && pair.positionA && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            {pair.positionA} + {pair.positionB}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          Alternation <span className="font-bold text-white">{tp.alternationScore}</span>
                        </span>
                        <span className="text-[10px] text-gray-600">
                          (r = {tp.correlation})
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">
                        Combined: <span className="text-white font-medium">{formatPrice(pair.combinedPrice)}m</span>
                        {" / "}
                        <span className="text-white font-medium">{formatDecimal(pair.combinedScore)} {sortLabel}</span>
                      </div>
                    </div>

                    {/* Two-player comparison row */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Player A */}
                      <div
                        className="rounded-lg p-3 cursor-pointer hover:bg-gray-800/80 transition-colors"
                        style={{ backgroundColor: "#1a1a1a" }}
                        onClick={() => handlePlayerClick(pair.playerA)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white">{pair.playerA.web_name}</span>
                          <span className="text-xs text-gray-400">{formatPrice(pair.playerA.price)}m</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{tp.teamA.shortName}{pair.positionA ? ` (${pair.positionA})` : ""}</span>
                          <span>{sortLabel}: {formatDecimal(getScore(pair.playerA))}</span>
                          <span>Form: {formatDecimal(pair.playerA.form_num)}</span>
                        </div>
                      </div>

                      {/* Player B */}
                      <div
                        className="rounded-lg p-3 cursor-pointer hover:bg-gray-800/80 transition-colors"
                        style={{ backgroundColor: "#1a1a1a" }}
                        onClick={() => handlePlayerClick(pair.playerB)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white">{pair.playerB.web_name}</span>
                          <span className="text-xs text-gray-400">{formatPrice(pair.playerB.price)}m</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{tp.teamB.shortName}{pair.positionB ? ` (${pair.positionB})` : ""}</span>
                          <span>{sortLabel}: {formatDecimal(getScore(pair.playerB))}</span>
                          <span>Form: {formatDecimal(pair.playerB.form_num)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Week-by-week FDR breakdown */}
                    <div className="flex gap-1">
                      {tp.weekByWeek.map((wk) => (
                        <div key={wk.gw} className="flex-1 text-center">
                          <div className="text-[9px] text-gray-600 mb-0.5">GW{wk.gw}</div>
                          {/* Team A FDR cell with opponent */}
                          <div
                            className="rounded-t text-[10px] font-bold py-0.5 px-0.5 leading-tight"
                            style={{
                              backgroundColor: fdrBg(Math.round(wk.fdrA)),
                              color: fdrText(Math.round(wk.fdrA)),
                              border: wk.pick === "A" ? "2px solid #fff" : "2px solid transparent",
                            }}
                            title={wk.oppA}
                          >
                            <div>{wk.oppA?.split(" ")[0] || wk.fdrA}</div>
                            <div className="text-[8px] font-normal opacity-80">{wk.oppA?.includes("(") ? wk.oppA.split(" ").pop() : ""}</div>
                          </div>
                          {/* Team B FDR cell with opponent */}
                          <div
                            className="rounded-b text-[10px] font-bold py-0.5 px-0.5 leading-tight"
                            style={{
                              backgroundColor: fdrBg(Math.round(wk.fdrB)),
                              color: fdrText(Math.round(wk.fdrB)),
                              border: wk.pick === "B" ? "2px solid #fff" : "2px solid transparent",
                            }}
                            title={wk.oppB}
                          >
                            <div>{wk.oppB?.split(" ")[0] || wk.fdrB}</div>
                            <div className="text-[8px] font-normal opacity-80">{wk.oppB?.includes("(") ? wk.oppB.split(" ").pop() : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Legend for week-by-week */}
                    <div className="flex items-center gap-4 text-[9px] text-gray-600">
                      <span>Top row: {tp.teamA.shortName}</span>
                      <span>Bottom row: {tp.teamB.shortName}</span>
                      <span>White border = start this player</span>
                      <span>Avg best FDR: {tp.avgBestFdr}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
