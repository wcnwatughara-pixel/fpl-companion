/**
 * Wildcard.jsx -- Wildcard Planner ("What If" Simulator)
 *
 * The core feature for wildcard planning. Shows:
 * - LEFT column: Current squad (read-only reference)
 * - RIGHT column: Wildcard squad (editable)
 *
 * Features:
 * - Lock players you want to keep
 * - Remove unlocked players and search for replacements
 * - Auto-fill: algorithm picks the best available players within budget
 * - Budget tracking with rule validation (position limits, team limits)
 * - Best Starting XI: once 15 players selected, tests all valid formations
 *   and picks the one with the highest total score (using the active sort mode)
 * - Score comparison: current best XI vs. wildcard best XI
 *
 * Feature 5: Premium range recalibration (PREMIUM_FLOOR 10.0->8.5, BUDGET_CEIL 6.0->5.5)
 * Feature 6: Budget reservation fix -- autoFill now reserves minimum budget for
 *            unfilled position slots so it doesn't blow the entire budget on early picks.
 */

import { useState, useMemo, useCallback } from "react";
import { useFpl } from "../context/FplContext.jsx";
import { selectBestXI, calculateBlendedScores } from "../utils/scoring.js";
import ScoreBar from "../components/ScoreBar.jsx";
import { FixtureMiniRow } from "../components/FixtureGrid.jsx";
import { formatPrice, formatDecimal } from "../utils/formatters.js";

// FPL squad rules
const POSITION_LIMITS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_TEAM = 3;
const SQUAD_SIZE = 15;

// ---------------------------------------------------------------------------
// Minimum cost per position -- used by autoFill's budget reservation system.
// These represent the cheapest viable player at each position in the 2025/26
// season, ensuring autoFill doesn't spend so much on early picks that it
// can't afford minimum-price players for remaining empty slots.
// ---------------------------------------------------------------------------
const MIN_POSITION_COST = { GKP: 4.0, DEF: 4.0, MID: 4.5, FWD: 4.5 };

/**
 * Absolute floor price for any position. Used as a fallback when a position
 * isn't found in MIN_POSITION_COST.
 */
const MIN_PLAYER_PRICE = 4.0;

// ---------------------------------------------------------------------------
// Sort mode: which metric drives auto-fill ranking and search result sorting
// ---------------------------------------------------------------------------
const WC_SORT_MODES = [
  { value: "composite",  label: "Composite"  },
  { value: "projected",  label: "Projected"  },
  { value: "blend",      label: "Blend"      },
];

// ---------------------------------------------------------------------------
// Strategy: how the auto-fill algorithm distributes budget across players
//
// - Balanced: pick the best available player regardless of price tier
// - Premium:  prioritise expensive, highly-owned players (Haaland/Salah tier)
//             because missing their hauls tanks your rank
// - Budget:   favour cheaper players to spread value across all positions
// ---------------------------------------------------------------------------
const STRATEGY_OPTIONS = [
  { value: "balanced", label: "Balanced" },
  { value: "premium",  label: "Premium"  },
  { value: "budget",   label: "Budget"   },
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

/**
 * Price thresholds for the strategy modifier.
 * "Premium" players cost >= PREMIUM_FLOOR; "budget" players cost < BUDGET_CEIL.
 * Players in between get a neutral modifier (1.0).
 *
 * Feature 5: Recalibrated for 2025/26 season.
 *   - PREMIUM_FLOOR lowered from 10.0 to 8.5 so premium MIDs (Saka 10.5,
 *     Palmer 10.0, etc.) and high-end DEFs (Alexander-Arnold 7.5+) are
 *     captured by the premium strategy.
 *   - BUDGET_CEIL lowered from 6.0 to 5.5 to tighten the "budget" band
 *     and avoid classifying viable mid-price MIDs (6.0-6.5) as budget picks.
 */
const PREMIUM_FLOOR = 8.5;
const BUDGET_CEIL = 5.5;

/**
 * getStrategyMultiplier -- boost or penalise a candidate's sort score
 * based on the active strategy and (optionally) per-position targeting.
 *
 * Returns a multiplier (> 1 = favoured, < 1 = penalised, 1 = neutral).
 *
 * @param {Object} candidate       - Player object (needs .price, .position_name)
 * @param {string} strategy        - "balanced" | "premium" | "budget"
 * @param {Set}    premiumPositions - Positions the user wants to go premium in
 *                                   (empty Set = no per-position targeting)
 */
function getStrategyMultiplier(candidate, strategy, premiumPositions) {
  if (strategy === "balanced") return 1;

  const isPremium = candidate.price >= PREMIUM_FLOOR;
  const isBudget  = candidate.price < BUDGET_CEIL;

  if (strategy === "premium") {
    // When per-position targeting is active, only boost premiums in
    // the targeted positions; other positions stay neutral.
    const positionTargeted =
      premiumPositions.size === 0 || premiumPositions.has(candidate.position_name);

    if (isPremium && positionTargeted) return 1.35;   // strong boost
    if (isPremium && !positionTargeted) return 1.0;   // not targeted, neutral
    if (isBudget) return 0.75;                        // mild penalty
    return 1.0;                                       // mid-range, neutral
  }

  // strategy === "budget"
  if (isBudget) return 1.3;   // boost cheap players
  if (isPremium) return 0.7;  // penalise expensive ones
  return 1.0;
}

/**
 * calcMinReserve -- calculate the minimum budget that must be reserved
 * for unfilled position slots.
 *
 * Feature 6: This prevents autoFill from blowing the entire budget on
 * expensive early picks and then being unable to afford minimum-price
 * players for remaining positions.
 *
 * For each position that still has empty slots, we multiply the number
 * of empty slots by the minimum cost for that position. The sum across
 * all positions is the "reserve" -- the budget autoFill must keep aside.
 *
 * @param {Object} posCounts    - Current position counts { GKP: n, DEF: n, MID: n, FWD: n }
 * @param {number} slotsToFill  - Total number of empty squad slots
 * @returns {number}            - Minimum budget to reserve
 */
function calcMinReserve(posCounts, slotsToFill) {
  if (slotsToFill <= 0) return 0;

  let reserve = 0;
  for (const [pos, limit] of Object.entries(POSITION_LIMITS)) {
    const filled = posCounts[pos] || 0;
    const empty = Math.max(0, limit - filled);
    reserve += empty * (MIN_POSITION_COST[pos] || MIN_PLAYER_PRICE);
  }
  return reserve;
}

export default function Wildcard() {
  const { players, picks, entry, loading, projectionHorizon } = useFpl();

  // The wildcard squad: array of { playerId, locked }
  const [wcSquad, setWcSquad] = useState([]);
  const [initialized, setInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [posFilter, setPosFilter] = useState("All");
  const [showSearch, setShowSearch] = useState(false);

  // Sort mode: which metric ranks players in auto-fill and search results
  const [sortMode, setSortMode] = useState("composite");

  // Strategy: how auto-fill distributes budget (balanced/premium/budget)
  const [strategy, setStrategy] = useState("balanced");

  // Per-position premium targeting: which positions to go premium in.
  // Empty set = apply the strategy globally (all positions).
  const [premiumPositions, setPremiumPositions] = useState(new Set());

  // Formation lock: null = auto-select best; [4,3,3] etc = locked formation
  const [selectedFormation, setSelectedFormation] = useState(null);

  // Total budget = squad value + bank (both from the entry endpoint)
  const totalBudget = useMemo(() => {
    if (!entry) return 100;
    return (entry.last_deadline_value + entry.last_deadline_bank) / 10;
  }, [entry]);

  // Initialize wildcard squad from current picks (once)
  if (!initialized && picks?.picks && players.length > 0) {
    const initial = picks.picks.map((pick) => ({
      playerId: pick.element,
      locked: false,
    }));
    setWcSquad(initial);
    setInitialized(true);
  }

  // Current squad player objects (from picks)
  const currentSquad = useMemo(() => {
    if (!picks?.picks || !players.length) return [];
    return picks.picks
      .map((pick) => players.find((p) => p.id === pick.element))
      .filter(Boolean);
  }, [picks, players]);

  // Wildcard squad player objects (enriched)
  const wcPlayers = useMemo(() => {
    return wcSquad
      .map((slot) => {
        const player = players.find((p) => p.id === slot.playerId);
        if (!player) return null;
        return { ...player, locked: slot.locked };
      })
      .filter(Boolean);
  }, [wcSquad, players]);

  // Budget calculations
  const spent = useMemo(() => {
    return wcPlayers.reduce((sum, p) => sum + p.price, 0);
  }, [wcPlayers]);
  const remaining = totalBudget - spent;

  // Validation
  const validationErrors = useMemo(() => {
    const errors = [];

    const posCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const teamCounts = {};

    for (const player of wcPlayers) {
      posCounts[player.position_name] = (posCounts[player.position_name] || 0) + 1;
      teamCounts[player.team] = (teamCounts[player.team] || 0) + 1;
    }

    for (const [pos, limit] of Object.entries(POSITION_LIMITS)) {
      if (posCounts[pos] > limit) {
        errors.push(`Too many ${pos} players (${posCounts[pos]}, max ${limit})`);
      }
    }

    for (const [teamId, count] of Object.entries(teamCounts)) {
      if (count > MAX_PER_TEAM) {
        const player = wcPlayers.find((p) => p.team === parseInt(teamId));
        errors.push(
          `Too many ${player?.team_full_name || "team"} players (${count}, max ${MAX_PER_TEAM})`
        );
      }
    }

    if (remaining < 0) {
      errors.push(`Over budget by ${formatPrice(Math.abs(remaining))}m`);
    }

    return errors;
  }, [wcPlayers, remaining]);

  // Position counts for the current wildcard squad
  const posCounts = useMemo(() => {
    const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of wcPlayers) {
      counts[p.position_name] = (counts[p.position_name] || 0) + 1;
    }
    return counts;
  }, [wcPlayers]);

  // ---------------------------------------------------------------------------
  // Best Starting XI (formation optimizer)
  // ---------------------------------------------------------------------------

  /**
   * getSortKey -- map the sort mode to the player field to sort by.
   * For "blend" mode, we compute blended scores on the fly below,
   * so the key is "blendedScore" (attached by calculateBlendedScores).
   */
  function getSortKey(mode) {
    if (mode === "projected") return "projectedPoints";
    if (mode === "blend") return "blendedScore";
    return "compositeScore";
  }

  /**
   * When we have 15 players, run the formation optimizer.
   * It tests all 7 valid FPL formations and picks the one whose
   * starting XI has the highest total score based on the active sort mode.
   *
   * When sortMode is "blend", we pre-calculate blended scores so
   * selectBestXI can sort by blendedScore.
   */
  const wcBestXI = useMemo(() => {
    if (wcPlayers.length < 15) return null;
    const key = getSortKey(sortMode);
    let squad = wcPlayers;
    if (sortMode === "blend") {
      squad = calculateBlendedScores([...wcPlayers]);
    }
    // Pass locked formation (null = auto-select best)
    return selectBestXI(squad, key, selectedFormation);
  }, [wcPlayers, sortMode, selectedFormation]);

  const currentBestXI = useMemo(() => {
    if (currentSquad.length < 15) return null;
    const key = getSortKey(sortMode);
    let squad = currentSquad;
    if (sortMode === "blend") {
      squad = calculateBlendedScores([...currentSquad]);
    }
    // Use the same locked formation for comparison fairness
    return selectBestXI(squad, key, selectedFormation);
  }, [currentSquad, sortMode, selectedFormation]);

  // Score comparisons use best XI scores (not all 15)
  const currentXIScore = currentBestXI?.totalScore ?? 0;
  const wcXIScore = wcBestXI?.totalScore ?? 0;

  // Sum projected points for the best XI players (separate from composite)
  const currentXIProjPts = useMemo(() => {
    if (!currentBestXI?.startingXI) return 0;
    return currentBestXI.startingXI.reduce((s, p) => s + (p.projectedPoints || 0), 0);
  }, [currentBestXI]);

  const wcXIProjPts = useMemo(() => {
    if (!wcBestXI?.startingXI) return 0;
    return wcBestXI.startingXI.reduce((s, p) => s + (p.projectedPoints || 0), 0);
  }, [wcBestXI]);

  // Search results: players not in wildcard squad, sorted by selected metric
  const searchResults = useMemo(() => {
    const wcIds = new Set(wcSquad.map((s) => s.playerId));
    let pool = players
      .filter((p) => !wcIds.has(p.id))
      .filter((p) => p.minutes >= 45)
      .filter((p) => posFilter === "All" || p.position_name === posFilter)
      .filter((p) => {
        if (!searchQuery) return true;
        return p.web_name.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .filter((p) => p.price <= remaining + 0.1);

    // If blend mode, calculate blended scores within the visible pool
    // so the 0-100 normalization is relative to what the user sees
    if (sortMode === "blend") {
      pool = calculateBlendedScores(pool);
    }

    const key = getSortKey(sortMode);
    return pool
      .sort((a, b) => (b[key] || 0) - (a[key] || 0))
      .slice(0, 15);
  }, [players, wcSquad, searchQuery, posFilter, remaining, sortMode]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const toggleLock = useCallback((playerId) => {
    setWcSquad((prev) =>
      prev.map((s) =>
        s.playerId === playerId ? { ...s, locked: !s.locked } : s
      )
    );
  }, []);

  const removePlayer = useCallback((playerId) => {
    setWcSquad((prev) => prev.filter((s) => s.playerId !== playerId));
  }, []);

  const addPlayer = useCallback(
    (playerId) => {
      if (wcSquad.length >= SQUAD_SIZE) return;
      if (wcSquad.some((s) => s.playerId === playerId)) return;
      setWcSquad((prev) => [...prev, { playerId, locked: false }]);
      setSearchQuery("");
      setShowSearch(false);
    },
    [wcSquad]
  );

  const resetSquad = useCallback(() => {
    if (!picks?.picks) return;
    setWcSquad(picks.picks.map((pick) => ({ playerId: pick.element, locked: false })));
  }, [picks]);

  /**
   * autoFill -- fill empty squad slots with the best available players.
   *
   * Respects three user-controlled knobs:
   *   1. sortMode    -- which base metric to rank candidates by
   *   2. strategy    -- whether to tilt toward premium or budget players
   *   3. premiumPositions -- which positions the premium tilt applies to
   *
   * The algorithm sorts candidates by (baseMetric * strategyMultiplier)
   * so the strategy acts as a tie-breaker / re-ranker on top of the
   * chosen metric, rather than overriding it completely.
   *
   * Feature 6: Budget reservation fix.
   * Before adding a candidate, we now check whether picking them would
   * leave enough budget to fill the remaining empty position slots at
   * minimum cost. This prevents the greedy algorithm from spending all
   * the budget on a few premium players and then being unable to
   * complete the squad.
   */
  const autoFill = useCallback(() => {
    const wcIds = new Set(wcSquad.map((s) => s.playerId));
    const currentPosCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const currentTeamCounts = {};

    for (const slot of wcSquad) {
      const p = players.find((pl) => pl.id === slot.playerId);
      if (p) {
        currentPosCounts[p.position_name] = (currentPosCounts[p.position_name] || 0) + 1;
        currentTeamCounts[p.team] = (currentTeamCounts[p.team] || 0) + 1;
      }
    }

    // Build the candidate pool and attach blend scores if needed
    let pool = players
      .filter((p) => !wcIds.has(p.id))
      .filter((p) => p.minutes >= 45);

    if (sortMode === "blend") {
      pool = calculateBlendedScores(pool);
    }

    const key = getSortKey(sortMode);

    // Sort by (base metric * strategy multiplier) so the strategy
    // nudges rankings without completely overriding the base metric
    const available = [...pool].sort((a, b) => {
      const aScore = (a[key] || 0) * getStrategyMultiplier(a, strategy, premiumPositions);
      const bScore = (b[key] || 0) * getStrategyMultiplier(b, strategy, premiumPositions);
      return bScore - aScore;
    });

    let budgetLeft = totalBudget - wcPlayers.reduce((s, p) => s + p.price, 0);
    const newSlots = [...wcSquad];

    for (const candidate of available) {
      if (newSlots.length >= SQUAD_SIZE) break;

      const pos = candidate.position_name;
      if ((currentPosCounts[pos] || 0) >= POSITION_LIMITS[pos]) continue;
      if ((currentTeamCounts[candidate.team] || 0) >= MAX_PER_TEAM) continue;

      // Feature 6: Budget reservation check.
      // Calculate how much budget would remain after picking this candidate,
      // then calculate the minimum reserve needed for the remaining empty
      // slots (excluding this candidate's position slot which we're about
      // to fill). If the remaining budget after the pick is less than the
      // reserve, skip this candidate -- we can't afford to pick them and
      // still fill the squad.
      const budgetAfterPick = budgetLeft - candidate.price;

      // Temporarily update position counts to reflect this pick,
      // so calcMinReserve sees accurate remaining empty slots
      const tempPosCounts = { ...currentPosCounts };
      tempPosCounts[pos] = (tempPosCounts[pos] || 0) + 1;
      const slotsAfterPick = SQUAD_SIZE - (newSlots.length + 1);
      const reserveAfterPick = calcMinReserve(tempPosCounts, slotsAfterPick);

      if (budgetAfterPick < reserveAfterPick) continue;

      newSlots.push({ playerId: candidate.id, locked: false });
      currentPosCounts[pos] = (currentPosCounts[pos] || 0) + 1;
      currentTeamCounts[candidate.team] = (currentTeamCounts[candidate.team] || 0) + 1;
      budgetLeft -= candidate.price;
    }

    setWcSquad(newSlots);
  }, [wcSquad, players, totalBudget, wcPlayers, sortMode, strategy, premiumPositions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading wildcard planner...</div>
      </div>
    );
  }

  if (!picks) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">
          Squad data needed. Make sure your Team ID is set and data is loaded.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Wildcard Planner</h1>

      {/* Budget bar */}
      <div className="rounded-lg p-4" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Budget</span>
          <span className="text-sm font-semibold tabular-nums">
            {formatPrice(spent)}m / {formatPrice(totalBudget)}m
            <span className={`ml-2 ${remaining >= 0 ? "text-green-400" : "text-red-400"}`}>
              ({remaining >= 0 ? "+" : ""}{formatPrice(remaining)}m)
            </span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, (spent / totalBudget) * 100)}%`,
              backgroundColor: remaining >= 0 ? "#22c55e" : "#ef4444",
            }}
          />
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-400">
          {Object.entries(POSITION_LIMITS).map(([pos, limit]) => (
            <span
              key={pos}
              className={posCounts[pos] > limit ? "text-red-400" : ""}
            >
              {pos}: {posCounts[pos] || 0}/{limit}
            </span>
          ))}
          <span>Total: {wcSquad.length}/{SQUAD_SIZE}</span>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-lg p-3 bg-red-900/30 border border-red-800/50">
          {validationErrors.map((err, i) => (
            <p key={i} className="text-xs text-red-400">{err}</p>
          ))}
        </div>
      )}

      {/* Controls: sort mode, strategy, and action buttons */}
      <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        {/* Row 1: Sort mode + Strategy toggle */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Sort mode selector */}
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Sort By
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              className="px-2 py-1.5 bg-[#0a0a0a] border border-[#333] rounded text-xs text-gray-200"
            >
              {WC_SORT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          {/* Strategy toggle */}
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Strategy
            <select
              value={strategy}
              onChange={(e) => {
                setStrategy(e.target.value);
                // Clear per-position targeting when switching away from premium
                if (e.target.value !== "premium") setPremiumPositions(new Set());
              }}
              className="px-2 py-1.5 bg-[#0a0a0a] border border-[#333] rounded text-xs text-gray-200"
            >
              {STRATEGY_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          {/* Formation selector: Auto tests all 7 and picks best;
              a specific formation locks the Best XI to that shape */}
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Formation
            <select
              value={selectedFormation ? selectedFormation.join("-") : "auto"}
              onChange={(e) => {
                if (e.target.value === "auto") {
                  setSelectedFormation(null);
                } else {
                  setSelectedFormation(e.target.value.split("-").map(Number));
                }
              }}
              className="px-2 py-1.5 bg-[#0a0a0a] border border-[#333] rounded text-xs text-gray-200"
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
          </label>
        </div>

        {/* Row 2: Per-position premium targeting (only visible in premium strategy) */}
        {strategy === "premium" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Go premium in:</span>
            {["GKP", "DEF", "MID", "FWD"].map((pos) => {
              const active = premiumPositions.has(pos);
              return (
                <button
                  key={pos}
                  onClick={() => {
                    setPremiumPositions((prev) => {
                      const next = new Set(prev);
                      if (next.has(pos)) next.delete(pos);
                      else next.add(pos);
                      return next;
                    });
                  }}
                  className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                    active
                      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                      : "bg-[#1a1a1a] text-gray-500 border-[#333] hover:border-gray-400"
                  }`}
                >
                  {pos}
                </button>
              );
            })}
            <span className="text-[10px] text-gray-600 ml-1">
              {premiumPositions.size === 0 ? "(all positions)" : `(${premiumPositions.size} selected)`}
            </span>
          </div>
        )}

        {/* Row 3: Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
            disabled={wcSquad.length >= SQUAD_SIZE}
          >
            + Add Player
          </button>
          <button
            onClick={autoFill}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors"
            disabled={wcSquad.length >= SQUAD_SIZE}
          >
            Auto-Fill
          </button>
          <button
            onClick={resetSquad}
            className="px-4 py-2 bg-[#222] hover:bg-[#333] rounded-lg text-sm font-medium transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Player search panel */}
      {showSearch && (
        <div className="rounded-lg p-4" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
          <div className="flex gap-3 mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for a player..."
              className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-sm focus:outline-none"
            />
            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
              className="px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-sm"
            >
              <option value="All">All</option>
              <option value="GKP">GKP</option>
              <option value="DEF">DEF</option>
              <option value="MID">MID</option>
              <option value="FWD">FWD</option>
            </select>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {searchResults.map((player) => (
              <div
                key={player.id}
                onClick={() => addPlayer(player.id)}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-[#1a1a1a] cursor-pointer"
              >
                <div>
                  <span className="text-sm font-medium">{player.web_name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {player.team_name} | {player.position_name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-gray-400">
                    {formatPrice(player.price)}m
                  </span>
                  {/* Show the metric matching the active sort mode */}
                  <span className={`text-xs tabular-nums ${
                    sortMode === "projected" ? "text-purple-400" :
                    sortMode === "blend"     ? "text-cyan-400"   : "text-green-400"
                  }`}>
                    {sortMode === "projected"
                      ? (player.projectedPoints || 0).toFixed(1)
                      : sortMode === "blend"
                        ? formatDecimal(player.blendedScore || 0)
                        : formatDecimal(player.compositeScore)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squad columns: current vs wildcard flat lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Current squad */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Current Squad</h2>
          <div className="space-y-1">
            {currentSquad.map((player) => (
              <SquadRow key={player.id} player={player} readonly />
            ))}
          </div>
        </div>

        {/* RIGHT: Wildcard squad */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Wildcard Squad</h2>
          <div className="space-y-1">
            {wcPlayers.map((player) => (
              <SquadRow
                key={player.id}
                player={player}
                locked={player.locked}
                onToggleLock={() => toggleLock(player.id)}
                onRemove={() => removePlayer(player.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Best Starting XI display (only when 15 players selected) */}
      {wcBestXI && (
        <div className="rounded-lg p-4" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-gray-300">
              Best Starting XI
            </h3>
            <span className="text-xs font-bold px-2 py-1 rounded bg-blue-600/20 text-blue-400 border border-blue-500/30">
              {wcBestXI.formation}
            </span>
            <span className="text-xs text-gray-500">
              XI Score: {wcBestXI.totalScore}
            </span>
          </div>

          {/* Starting XI grouped by position */}
          <div className="space-y-3">
            <FormationRow label="GKP" color="#f59e0b" players={wcBestXI.startingXI.filter((p) => p.position_name === "GKP")} />
            <FormationRow label="DEF" color="#22c55e" players={wcBestXI.startingXI.filter((p) => p.position_name === "DEF")} />
            <FormationRow label="MID" color="#3b82f6" players={wcBestXI.startingXI.filter((p) => p.position_name === "MID")} />
            <FormationRow label="FWD" color="#ef4444" players={wcBestXI.startingXI.filter((p) => p.position_name === "FWD")} />
          </div>

          {/* Bench (ordered by composite score) */}
          <div className="mt-4 pt-3 border-t border-[#222]">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">Bench (ordered by priority)</h4>
            <div className="space-y-1">
              {wcBestXI.bench.map((player, i) => (
                <div
                  key={player.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
                  style={{ backgroundColor: "#0a0a0a" }}
                >
                  <span className="text-gray-600 w-4">{i + 1}.</span>
                  <span
                    className="text-[9px] font-bold px-1 py-0.5 rounded min-w-[2rem] text-center"
                    style={{
                      backgroundColor:
                        player.position_name === "GKP" ? "#f59e0b" :
                        player.position_name === "DEF" ? "#22c55e" :
                        player.position_name === "MID" ? "#3b82f6" : "#ef4444",
                      color: "#000",
                      opacity: 0.6,
                    }}
                  >
                    {player.position_name}
                  </span>
                  <span className="flex-1 text-gray-400">{player.web_name}</span>
                  <span className="text-gray-500 tabular-nums">{player.team_name}</span>
                  <span className="text-gray-500 tabular-nums w-10 text-right">
                    {formatDecimal(player.compositeScore)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Score comparison (uses best XI scores) */}
      <div className="rounded-lg p-4" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          Score Comparison
          <span className="text-xs font-normal text-gray-500 ml-2">
            {wcBestXI ? "Best XI" : "Full squad"}
          </span>
        </h3>

        {/* Composite score comparison */}
        <div className="text-xs text-gray-500 mb-1 font-medium">Composite Score</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">
              Current {currentBestXI ? `(${currentBestXI.formation})` : "Squad"}
            </div>
            <div className="text-2xl font-bold tabular-nums">{currentXIScore.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">
              Wildcard {wcBestXI ? `(${wcBestXI.formation})` : "Squad"}
            </div>
            <div
              className="text-2xl font-bold tabular-nums"
              style={{
                color: wcXIScore > currentXIScore ? "#22c55e" :
                       wcXIScore < currentXIScore ? "#ef4444" : "#fafafa",
              }}
            >
              {wcXIScore.toFixed(1)}
              {wcXIScore !== currentXIScore && (
                <span className="text-sm ml-2">
                  ({wcXIScore > currentXIScore ? "+" : ""}
                  {(wcXIScore - currentXIScore).toFixed(1)})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Projected points comparison */}
        <div className="pt-3 border-t border-[#222]">
          <div className="text-xs text-gray-500 mb-1 font-medium">
            Projected Points
            <span className="text-gray-600 ml-1">(next {projectionHorizon} GW{projectionHorizon > 1 ? "s" : ""})</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-400 mb-1">Current XI</div>
              <div className="text-2xl font-bold tabular-nums text-purple-400">
                {currentXIProjPts.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Wildcard XI</div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={{
                  color: wcXIProjPts > currentXIProjPts ? "#a855f7" :
                         wcXIProjPts < currentXIProjPts ? "#ef4444" : "#c084fc",
                }}
              >
                {wcXIProjPts.toFixed(1)}
                {wcXIProjPts !== currentXIProjPts && (
                  <span className="text-sm ml-2">
                    ({wcXIProjPts > currentXIProjPts ? "+" : ""}
                    {(wcXIProjPts - currentXIProjPts).toFixed(1)})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formation row: shows players in a position group side by side
// ---------------------------------------------------------------------------

function FormationRow({ label, color, players }) {
  if (!players.length) return null;

  return (
    <div className="flex items-start gap-2">
      <span
        className="text-[9px] font-bold px-1 py-0.5 rounded min-w-[2rem] text-center mt-1.5"
        style={{ backgroundColor: color, color: "#000" }}
      >
        {label}
      </span>
      <div className="flex-1 flex flex-wrap gap-1">
        {players.map((player) => (
          <div
            key={player.id}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs"
            style={{ backgroundColor: "#1a1a1a" }}
          >
            <span className="font-medium">{player.web_name}</span>
            <span className="text-gray-500">{player.team_name}</span>
            <span className="text-green-400 tabular-nums">{formatDecimal(player.compositeScore)}</span>
            <span className="text-purple-400 tabular-nums" title="Proj Pts">
              {player.projectedPoints != null ? player.projectedPoints.toFixed(1) : "-"}
            </span>
            {player.chance_of_playing < 100 && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
                {player.chance_of_playing}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Squad row component (used in both columns)
// ---------------------------------------------------------------------------

function SquadRow({ player, readonly, locked, onToggleLock, onRemove }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
      style={{ backgroundColor: "#111", border: "1px solid #1a1a1a" }}
    >
      <span
        className="text-[9px] font-bold px-1 py-0.5 rounded min-w-[2rem] text-center"
        style={{
          backgroundColor:
            player.position_name === "GKP" ? "#f59e0b" :
            player.position_name === "DEF" ? "#22c55e" :
            player.position_name === "MID" ? "#3b82f6" : "#ef4444",
          color: "#000",
        }}
      >
        {player.position_name}
      </span>

      <span className="flex-1 font-medium text-xs truncate">
        {player.web_name}
        {player.chance_of_playing < 100 && (
          <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
            {player.chance_of_playing}%
          </span>
        )}
      </span>

      <span className="text-xs text-gray-500">{player.team_name}</span>

      <span className="text-xs text-gray-400 tabular-nums w-12 text-right">
        {formatPrice(player.price)}m
      </span>

      <span className="text-xs tabular-nums w-10 text-right text-green-400">
        {formatDecimal(player.compositeScore)}
      </span>

      {/* Projected points (purple to distinguish from composite green) */}
      <span className="text-xs tabular-nums w-10 text-right text-purple-400" title="Projected Pts">
        {player.projectedPoints != null ? player.projectedPoints.toFixed(1) : "-"}
      </span>

      {!readonly && (
        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={onToggleLock}
            className={`text-sm px-1 ${locked ? "text-yellow-400" : "text-gray-600"}`}
            title={locked ? "Unlock" : "Lock"}
          >
            {locked ? "\u{1F512}" : "\u{1F513}"}
          </button>
          {!locked && (
            <button
              onClick={onRemove}
              className="text-xs text-gray-600 hover:text-red-400 px-1"
              title="Remove"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
