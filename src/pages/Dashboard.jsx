/**
 * Dashboard.jsx -- My Squad view (home page)
 *
 * Shows the user's current 15-man squad with key stats.
 * Top summary bar shows total points, rank, squad value, bank.
 * Each player appears as a PlayerCard.
 * Click a player to jump to Compare with that player pre-selected.
 */

import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useFpl } from "../context/FplContext.jsx";
import PlayerCard from "../components/PlayerCard.jsx";
import { formatNumber, formatPrice } from "../utils/formatters.js";
import Tooltip from "../components/Tooltip.jsx";
import { getMetric } from "../data/metricDefinitions.js";
import { fetchAutoSubs, fetchGwTransfers } from "../utils/teamChanges.js";

export default function Dashboard() {
  const { players, entry, picks, loading, error, teamId, currentGw } = useFpl();
  const navigate = useNavigate();

  // ---------------------------------------------------------------------------
  // Auto-subs and transfers state
  // ---------------------------------------------------------------------------

  const [autoSubs, setAutoSubs] = useState([]);
  const [gwTransfers, setGwTransfers] = useState([]);
  const [transfersCost, setTransfersCost] = useState(0);
  const [activeChip, setActiveChip] = useState(null);

  // Fetch auto-subs and transfers when currentGw or teamId changes.
  // Uses currentGw (not planningGw) because we want to show what happened
  // in the GW that's in progress or just finished, not the next one.
  useEffect(() => {
    if (!teamId || !currentGw || !players.length) return;

    let cancelled = false;

    async function loadChanges() {
      // Fetch auto-subs from the picks endpoint
      const subsData = await fetchAutoSubs(teamId, currentGw, players);
      if (cancelled) return;
      setAutoSubs(subsData.autoSubs);
      setTransfersCost(subsData.transfersCost);
      setActiveChip(subsData.chip);

      // Fetch ALL transfers, then pick the most recent GW that has any.
      // This way transfers are visible even between GWs when no new
      // transfers have been made for the upcoming deadline yet.
      try {
        const res = await fetch(`/api/entry/${teamId}/transfers/`);
        if (!res.ok || cancelled) return;
        const allTransfers = await res.json();
        if (cancelled || allTransfers.length === 0) return;

        // Find the most recent GW with transfers (API returns newest first)
        const latestGw = allTransfers[0].event;
        const latestTransfers = allTransfers.filter((t) => t.event === latestGw);

        // Build player lookup for name resolution
        const playerMap = {};
        for (const p of players) playerMap[p.id] = p;

        const enriched = latestTransfers.map((t) => ({
          playerIn: playerMap[t.element_in] || { web_name: `ID ${t.element_in}`, position_name: "???", team_name: "???" },
          playerOut: playerMap[t.element_out] || { web_name: `ID ${t.element_out}`, position_name: "???", team_name: "???" },
          costIn: t.element_in_cost / 10,
          costOut: t.element_out_cost / 10,
          time: t.time,
          gw: t.event,
        }));

        setGwTransfers(enriched);
      } catch (err) {
        console.warn("[Dashboard] Failed to fetch transfers:", err.message);
      }
    }

    loadChanges();
    return () => { cancelled = true; };
  }, [teamId, currentGw, players]);

  // ---------------------------------------------------------------------------
  // Apply auto-subs to get the final post-substitution lineup
  // ---------------------------------------------------------------------------

  /**
   * Apply automatic substitutions to the picks array.
   * Swaps element_in for element_out in the starting XI positions,
   * reflecting the final post-sub lineup FPL actually scored.
   *
   * How FPL auto-subs work: if a starting player (positions 1-11) didn't
   * play at all, FPL swaps in the highest-priority bench player (positions
   * 12-15) who is eligible for that formation slot. This function mirrors
   * that by swapping positions between the outgoing and incoming players.
   */
  const finalPicks = useMemo(() => {
    if (!picks?.picks?.length) return [];
    if (!autoSubs.length) return picks.picks;

    // Work on a copy so we don't mutate the original
    const updated = picks.picks.map((p) => ({ ...p }));

    for (const sub of autoSubs) {
      const outId = sub.playerOut.id;
      const inId = sub.playerIn.id;

      const outIdx = updated.findIndex((p) => p.element === outId);
      const inIdx = updated.findIndex((p) => p.element === inId);

      if (outIdx !== -1 && inIdx !== -1) {
        // Swap their squad positions so the sub appears in the XI
        const tempPos = updated[outIdx].position;
        updated[outIdx].position = updated[inIdx].position;
        updated[inIdx].position = tempPos;

        // The subbed-in player inherits the outgoing player's multiplier
        // (handles the edge case where the captain didn't play and
        // captaincy falls to the vice, then to the auto-sub)
        updated[inIdx].multiplier = updated[outIdx].multiplier;
        updated[outIdx].multiplier = 0;
      }
    }

    // Re-sort by position so display order is correct
    updated.sort((a, b) => a.position - b.position);
    return updated;
  }, [picks, autoSubs]);

  // Build the squad using the post-sub lineup (finalPicks)
  const squad = useMemo(() => {
    if (!finalPicks.length || !players.length) return [];

    return finalPicks
      .map((pick) => {
        const player = players.find((p) => p.id === pick.element);
        if (!player) return null;
        return {
          ...player,
          squadPosition: pick.position, // 1-11 = starting, 12-15 = bench
          isCaptain: pick.is_captain,
          isViceCaptain: pick.is_vice_captain,
          // Track if this player was auto-subbed in or out
          wasSubbedOut: pick.multiplier === 0 && autoSubs.some(
            (s) => s.playerOut.id === pick.element
          ),
          wasSubbedIn: autoSubs.some(
            (s) => s.playerIn.id === pick.element
          ),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.squadPosition - b.squadPosition);
  }, [finalPicks, players, autoSubs]);

  // Separate starting XI from bench
  const startingXI = squad.filter((p) => p.squadPosition <= 11);
  const bench = squad.filter((p) => p.squadPosition > 11);

  /**
   * When a player card is clicked, navigate to Compare
   * with that player's ID in the URL so it's pre-selected.
   */
  const handlePlayerClick = (player) => {
    navigate(`/compare?player=${player.id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading squad data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  if (!picks) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">
          No squad data found. Make sure your Team ID is correct and at least one gameweek has been played.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      {entry && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Total Points" value={formatNumber(entry.summary_overall_points)} metricKey="totalPoints" />
          <SummaryCard label="Overall Rank" value={formatNumber(entry.summary_overall_rank)} metricKey="overallRank" />
          <SummaryCard label="GW Points" value={formatNumber(entry.summary_event_points)} metricKey="gwPoints" />
          <SummaryCard label="Squad Value" value={`${formatPrice(entry.last_deadline_value / 10)}m`} metricKey="squadValue" />
          <SummaryCard label="Bank" value={`${formatPrice(entry.last_deadline_bank / 10)}m`} metricKey="bank" />
        </div>
      )}

      {/* Team name */}
      {entry && (
        <h2 className="text-lg font-semibold text-gray-300">
          {entry.name}
          <span className="text-sm text-gray-500 ml-2">
            {entry.player_first_name} {entry.player_last_name}
          </span>
        </h2>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* GW Transfers and Auto-Subs                                         */}
      {/* Shows what changed in the current gameweek: transfers the manager   */}
      {/* made, any point hits, active chip, and auto-subs applied by FPL.   */}
      {/* ----------------------------------------------------------------- */}
      {(gwTransfers.length > 0 || autoSubs.length > 0 || activeChip) && (
        <div className="rounded-lg p-4 space-y-4" style={{ backgroundColor: "#111", border: "1px solid #222" }}>

          {/* Active chip indicator (wildcard, bench_boost, triple_captain, free_hit) */}
          {activeChip && (
            <div className="text-xs font-bold text-yellow-400 uppercase tracking-wide">
              {activeChip.replace(/_/g, " ")} active
            </div>
          )}

          {/* Transfers made this GW */}
          {gwTransfers.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                Transfers
                {/* Show which GW these transfers were for */}
                {gwTransfers[0]?.gw && (
                  <span className="ml-1 normal-case text-gray-500">(GW{gwTransfers[0].gw})</span>
                )}
                {/* Show the hit cost if there was one (e.g. -4 pts) */}
                {transfersCost > 0 && (
                  <span className="ml-2 text-red-400 normal-case">
                    (-{transfersCost} pts)
                  </span>
                )}
              </h3>
              <div className="space-y-1.5">
                {gwTransfers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {/* Player out (red) */}
                    <div className="flex items-center gap-1 text-red-400 min-w-[120px]">
                      <span className="text-[10px]">{t.playerOut.position_name}</span>
                      <span className="font-medium">{t.playerOut.web_name}</span>
                      <span className="text-gray-500">{t.costOut.toFixed(1)}m</span>
                    </div>
                    {/* Arrow */}
                    <span className="text-gray-500">{"\u2192"}</span>
                    {/* Player in (green) */}
                    <div className="flex items-center gap-1 text-green-400">
                      <span className="text-[10px]">{t.playerIn.position_name}</span>
                      <span className="font-medium">{t.playerIn.web_name}</span>
                      <span className="text-gray-500">{t.costIn.toFixed(1)}m</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-subs applied by FPL after the GW finished */}
          {autoSubs.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                Auto-Subs
              </h3>
              <div className="space-y-1.5">
                {autoSubs.map((sub, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {/* Player subbed out (dimmed, didn't play) */}
                    <div className="flex items-center gap-1 text-gray-500 min-w-[120px]">
                      <span className="text-[10px]">{sub.playerOut.position_name}</span>
                      <span className="font-medium">{sub.playerOut.web_name}</span>
                    </div>
                    {/* Arrow */}
                    <span className="text-gray-500">{"\u2192"}</span>
                    {/* Player subbed in (highlighted in blue) */}
                    <div className="flex items-center gap-1 text-blue-400">
                      <span className="text-[10px]">{sub.playerIn.position_name}</span>
                      <span className="font-medium">{sub.playerIn.web_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Starting XI (reflects post-auto-sub lineup when subs have been applied) */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Starting XI</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {startingXI.map((player) => (
            <div key={player.id} className="relative">
              {/* Captain / vice badge */}
              {(player.isCaptain || player.isViceCaptain) && (
                <div className="absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full bg-yellow-500 text-black text-[10px] font-bold flex items-center justify-center">
                  {player.isCaptain ? "C" : "V"}
                </div>
              )}
              <PlayerCard player={player} onClick={handlePlayerClick} />
            </div>
          ))}
        </div>
      </div>

      {/* Bench */}
      {bench.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Bench</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {bench.map((player) => (
              <div key={player.id} className="opacity-70">
                <PlayerCard player={player} onClick={handlePlayerClick} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small summary statistic card for the top bar.
 */
function SummaryCard({ label, value, metricKey }) {
  const tooltip = metricKey ? getMetric(metricKey).short : "";
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: "#111111", border: "1px solid #222" }}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">
        <Tooltip text={tooltip}>{label}</Tooltip>
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
