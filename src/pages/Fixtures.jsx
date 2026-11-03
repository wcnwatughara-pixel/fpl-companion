/**
 * Fixtures.jsx -- Team fixtures overview + PPDU standings
 *
 * Two sections:
 *
 * 1. Fixture Grid: Shows each team's upcoming fixtures (next 6 GWs)
 *    with FDR color coding. Matches the official FPL FDR page layout:
 *    each cell shows opponent short name + (H)/(A) venue indicator,
 *    color-coded by fixture difficulty.
 *
 * 2. PPDU (Points Per Difficulty Unit) Table: A fixture-adjusted league
 *    standing. PPDU = team PL points / mean FDR of completed fixtures.
 *    Teams that have earned points against tougher opposition rank higher.
 *    This is a visual-only section; PPDU is NOT factored into composite scoring.
 *
 * Uses planningGw for the fixture grid (forward-looking) and the raw
 * fixtures array for PPDU calculation (backward-looking at completed games).
 *
 * FDR colors are imported from fdrColors.js (shared with PlayerCard, etc.)
 * so the scale stays consistent across the entire app.
 */

import { useMemo, useState } from "react";
import { useFpl } from "../context/FplContext.jsx";
import { buildUpcomingFixtures } from "../utils/transforms.js";
import { calculatePPDU } from "../utils/ppdu.js";
import { findBestPairings } from "../utils/fixturePairings.js";
import { fdrBg, fdrText } from "../utils/fdrColors.js";
import Tooltip from "../components/Tooltip.jsx";

// ---------------------------------------------------------------------------
// PPDU bar width helper
// ---------------------------------------------------------------------------

/**
 * Scale PPDU to a percentage width for the inline bar.
 * Uses the max PPDU in the dataset as 100%.
 */
function ppduBarWidth(ppdu, maxPpdu) {
  if (!maxPpdu) return 0;
  return Math.round((ppdu / maxPpdu) * 100);
}

// ---------------------------------------------------------------------------
// PPDU export helpers
// ---------------------------------------------------------------------------

/**
 * Export PPDU standings as a CSV file for analysis in spreadsheet software.
 *
 * Includes both backward-looking data (completed FDRs, W/D/L, PPDU) and
 * forward-looking data (upcoming FDRs for the next 6 GWs as separate columns).
 * This gives the analyst everything needed to project PPDU shifts without
 * needing a second data source.
 *
 * Upcoming FDRs are in separate columns (FDR_GW7, FDR_GW8, etc.) so each
 * GW can be individually sorted, filtered, or used in formulas. A blank
 * GW (no fixture) shows as empty. A double GW shows both FDRs joined
 * with a slash (e.g. "3/4").
 *
 * @param {Array} standings - The ppduStandings array from calculatePPDU
 * @param {Object} upcomingByTeam - { teamId: [{ gw, fdr, opponent, is_home }] }
 * @param {Array} gwRange - Array of upcoming GW numbers, e.g. [7, 8, 9, 10, 11, 12]
 */
function exportPpduCsv(standings, upcomingByTeam, gwRange) {
  if (!standings.length) return;

  // Header row: core PPDU fields + one column per upcoming GW + completed FDRs
  const headers = [
    "Rank", "Team", "Short", "P", "W", "D", "L", "Pts", "Avg FDR", "PPDU",
    // One column per upcoming GW, labeled with the GW number
    ...gwRange.map((gw) => `FDR_GW${gw}`),
    // Upcoming average FDR for quick reference (mean of the upcoming FDRs)
    "Upcoming_Avg_FDR",
    // Completed fixture FDRs as a semicolon-separated list
    "Completed_FDRs",
  ];

  const rows = standings.map((team, idx) => {
    // Get this team's upcoming fixtures, keyed by GW for quick lookup
    const teamUpcoming = upcomingByTeam[team.teamId] || [];
    const upcomingByGw = {};
    for (const fix of teamUpcoming) {
      if (!upcomingByGw[fix.gw]) upcomingByGw[fix.gw] = [];
      upcomingByGw[fix.gw].push(fix);
    }

    // Build one cell per upcoming GW.
    // Shows FDR value(s). Blank GW = empty cell.
    // Double GW = "3/4" (both FDRs separated by slash).
    const upcomingFdrCells = gwRange.map((gw) => {
      const gwFixes = upcomingByGw[gw];
      if (!gwFixes || gwFixes.length === 0) return "";
      return gwFixes.map((f) => f.fdr).join("/");
    });

    // Calculate average FDR of upcoming fixtures for quick reference.
    // Useful for sorting teams by schedule difficulty without manual work.
    const allUpcomingFdrs = teamUpcoming.map((f) => f.fdr);
    const upcomingAvgFdr = allUpcomingFdrs.length > 0
      ? (allUpcomingFdrs.reduce((s, v) => s + v, 0) / allUpcomingFdrs.length).toFixed(2)
      : "";

    return [
      idx + 1,
      team.teamName,
      team.shortName,
      team.played,
      team.wins,
      team.draws,
      team.losses,
      team.plPoints,
      team.meanFdr.toFixed(2),
      team.ppdu.toFixed(2),
      ...upcomingFdrCells,
      upcomingAvgFdr,
      // Completed FDRs as semicolon-separated list in one cell
      team.completedFdrs.join(";"),
    ];
  });

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  // Trigger download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ppdu_standings.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export PPDU standings as a JSON file for programmatic analysis.
 *
 * Includes both backward-looking PPDU data and forward-looking upcoming
 * fixture FDRs. The upcoming fixtures include opponent, venue (home/away),
 * and FDR for each GW, giving full context for projecting PPDU shifts.
 *
 * @param {Array} standings - The ppduStandings array from calculatePPDU
 * @param {Object} upcomingByTeam - { teamId: [{ gw, fdr, opponent, is_home }] }
 * @param {Array} gwRange - Array of upcoming GW numbers
 */
function exportPpduJson(standings, upcomingByTeam, gwRange) {
  if (!standings.length) return;

  const envelope = {
    exportedAt: new Date().toISOString(),
    totalTeams: standings.length,
    // Include the GW range so the consumer knows which GWs the
    // upcoming data covers without having to infer it
    upcomingGwRange: gwRange,
    standings: standings.map((team, idx) => {
      // Get this team's upcoming fixtures with full detail
      const teamUpcoming = upcomingByTeam[team.teamId] || [];

      return {
        rank: idx + 1,
        teamName: team.teamName,
        shortName: team.shortName,
        played: team.played,
        wins: team.wins,
        draws: team.draws,
        losses: team.losses,
        plPoints: team.plPoints,
        meanFdr: team.meanFdr,
        ppdu: team.ppdu,
        completedFdrs: team.completedFdrs,
        // Forward-looking: upcoming fixtures with opponent, venue, and FDR
        // per GW so the analyst can project how PPDU will shift
        upcomingFixtures: teamUpcoming.map((f) => ({
          gw: f.gw,
          opponent: f.opponent,
          isHome: f.is_home,
          fdr: f.fdr,
        })),
      };
    }),
  };

  const jsonContent = JSON.stringify(envelope, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ppdu_standings.json";
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Number of upcoming GWs to show in the fixture grid */
const FIXTURE_LOOKAHEAD = 5;

/**
 * Sort options for the fixture grid.
 * "easiest" sorts by lowest average upcoming FDR first (best fixture run).
 * "hardest" sorts by highest average upcoming FDR first (toughest run).
 * "az" sorts alphabetically by team short name.
 */
const GRID_SORT_OPTIONS = [
  { value: "easiest", label: "Easiest" },
  { value: "hardest", label: "Hardest" },
  { value: "az",      label: "A\u2013Z" },
];

export default function Fixtures() {
  const { teamsById, planningGw, fixtures, loading } = useFpl();
  const [activeTab, setActiveTab] = useState("grid"); // "grid" | "ppdu" | "pairings"
  // Grid sort: "easiest" (default) | "hardest" | "az"
  const [gridSort, setGridSort] = useState("easiest");
  // Pairings horizon: how many upcoming GWs to analyze for alternation
  const [pairingHorizon, setPairingHorizon] = useState(5);

  // Build upcoming fixtures from planningGw (forward-looking, next 5 GWs)
  const upcomingByTeam = useMemo(() => {
    if (!fixtures?.length || !teamsById || !planningGw) return {};
    return buildUpcomingFixtures(fixtures, teamsById, planningGw, FIXTURE_LOOKAHEAD);
  }, [fixtures, teamsById, planningGw]);

  // Calculate each team's average upcoming FDR for sorting.
  // Returns { teamId: avgFdr } where avgFdr is the mean FDR of the
  // team's next N fixtures. Lower = easier run.
  const teamAvgUpcomingFdr = useMemo(() => {
    const avgMap = {};
    for (const team of Object.values(teamsById)) {
      const teamFixtures = upcomingByTeam[team.id] || [];
      if (teamFixtures.length === 0) {
        // No upcoming fixtures -- neutral FDR so they sort to middle
        avgMap[team.id] = 3.0;
        continue;
      }
      const totalFdr = teamFixtures.reduce((sum, f) => sum + f.fdr, 0);
      avgMap[team.id] = totalFdr / teamFixtures.length;
    }
    return avgMap;
  }, [teamsById, upcomingByTeam]);

  // Sort teams based on the selected grid sort mode
  const sortedTeams = useMemo(() => {
    const teams = Object.values(teamsById);
    if (gridSort === "easiest") {
      // Lowest average upcoming FDR first (easiest fixture run at top)
      return teams.sort((a, b) => teamAvgUpcomingFdr[a.id] - teamAvgUpcomingFdr[b.id]);
    }
    if (gridSort === "hardest") {
      // Highest average upcoming FDR first (toughest fixture run at top)
      return teams.sort((a, b) => teamAvgUpcomingFdr[b.id] - teamAvgUpcomingFdr[a.id]);
    }
    // Default: alphabetical by short name
    return teams.sort((a, b) => a.short_name.localeCompare(b.short_name));
  }, [teamsById, gridSort, teamAvgUpcomingFdr]);

  // Determine the GW range shown in the grid header
  const gwRange = useMemo(() => {
    if (!planningGw) return [];
    return Array.from({ length: FIXTURE_LOOKAHEAD }, (_, i) => planningGw + i);
  }, [planningGw]);

  // Calculate PPDU standings (backward-looking, uses completed fixtures)
  const ppduStandings = useMemo(() => {
    if (!fixtures?.length || !teamsById) return [];
    return calculatePPDU(teamsById, fixtures);
  }, [teamsById, fixtures]);

  // Max PPDU for bar scaling
  const maxPpdu = useMemo(() => {
    if (!ppduStandings.length) return 0;
    return ppduStandings[0].ppdu; // already sorted descending
  }, [ppduStandings]);

  // ---------------------------------------------------------------------------
  // Fixture pairings: build upcoming fixtures for the pairing horizon
  // and find the best alternating pairs
  // ---------------------------------------------------------------------------

  // Build upcoming fixtures specifically for the pairing horizon
  // (may differ from the grid's FIXTURE_LOOKAHEAD)
  const pairingUpcoming = useMemo(() => {
    if (!fixtures?.length || !teamsById || !planningGw) return {};
    return buildUpcomingFixtures(fixtures, teamsById, planningGw, pairingHorizon);
  }, [fixtures, teamsById, planningGw, pairingHorizon]);

  // GW range for pairings
  const pairingGwRange = useMemo(() => {
    if (!planningGw) return [];
    return Array.from({ length: pairingHorizon }, (_, i) => planningGw + i);
  }, [planningGw, pairingHorizon]);

  // Find the best fixture-alternating team pairs
  const pairings = useMemo(() => {
    if (!pairingUpcoming || !Object.keys(pairingUpcoming).length) return [];
    return findBestPairings(pairingUpcoming, teamsById, pairingGwRange);
  }, [pairingUpcoming, teamsById, pairingGwRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Fixtures</h1>

      {/* Tab toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab("grid")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "grid"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          Fixture Grid
        </button>
        <button
          onClick={() => setActiveTab("ppdu")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "ppdu"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          <Tooltip text="Points Per Difficulty Unit: team PL points divided by average FDR of completed fixtures. Higher = better performance relative to difficulty faced.">
            PPDU Standings
          </Tooltip>
        </button>
        <button
          onClick={() => setActiveTab("pairings")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "pairings"
              ? "bg-[#333] text-white"
              : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
          }`}
        >
          <Tooltip text="Find pairs of teams whose fixture schedules alternate: when one has hard games, the other has easy ones. Own players from both to always have someone on a green run.">
            Fixture Pairings
          </Tooltip>
        </button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Fixture Grid tab                                                   */}
      {/* Matches the official FPL FDR page layout:                          */}
      {/* - Each cell shows opponent short name + (H) or (A) venue label     */}
      {/* - Cells are color-coded by FDR using the official 5-color scale    */}
      {/* - Blank GWs show a dash; double GWs stack vertically              */}
      {/* - Sort by easiest/hardest fixture run or alphabetically            */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "grid" && (
        <>
        {/* Grid sort toggle: Easiest (default) / Hardest / A-Z.
            Easiest sorts by lowest average upcoming FDR over the next 5 GWs,
            surfacing teams with the best fixture runs for transfer targeting. */}
        <div className="flex items-center gap-2">
          {GRID_SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGridSort(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                gridSort === opt.value
                  ? "bg-[#333] text-white"
                  : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg overflow-x-auto" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="text-left py-2 px-3 sticky left-0 bg-[#111] z-10">Team</th>
                {gwRange.map((gw) => (
                  <th key={gw} className="text-center py-2 px-3 min-w-[80px]">
                    GW{gw}
                  </th>
                ))}
                {/* Average upcoming FDR column -- shows the mean difficulty
                    of the next N fixtures, which is what the sort uses */}
                <th className="text-center py-2 px-3 min-w-[50px]">
                  <Tooltip text="Average FDR of the next 5 fixtures. Lower = easier run.">Avg</Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTeams.map((team) => {
                const teamFixtures = upcomingByTeam[team.id] || [];
                return (
                  <tr key={team.id} className="border-t border-[#1a1a1a]">
                    {/* Team name -- sticky on horizontal scroll */}
                    <td className="py-2 px-3 font-medium whitespace-nowrap sticky left-0 bg-[#111] z-10">
                      {team.short_name}
                    </td>
                    {/* One cell per GW in the range */}
                    {gwRange.map((gw) => {
                      // Find fixture(s) for this team in this GW.
                      // A team can have 0 fixtures in a blank GW, or
                      // rarely 2 in a double GW.
                      const gwFixtures = teamFixtures.filter((f) => f.gw === gw);

                      if (gwFixtures.length === 0) {
                        // Blank gameweek -- no fixture scheduled
                        return (
                          <td key={gw} className="py-2 px-3 text-center text-gray-600">
                            -
                          </td>
                        );
                      }

                      return (
                        <td key={gw} className="py-1 px-1 text-center">
                          <div className="flex flex-col gap-0.5">
                            {gwFixtures.map((fix, i) => (
                              <div
                                key={i}
                                className="rounded px-2 py-1 text-[11px] font-bold"
                                style={{
                                  backgroundColor: fdrBg(fix.fdr),
                                  color: fdrText(fix.fdr),
                                }}
                                title={`${fix.opponent_full} (FDR ${fix.fdr}) ${fix.is_home ? "Home" : "Away"}`}
                              >
                                {/* FPL-style: opponent short name + (H) or (A) venue label */}
                                {fix.opponent} ({fix.is_home ? "H" : "A"})
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                    {/* Average upcoming FDR cell -- color-coded by rounded value */}
                    <td className="py-2 px-2 text-center">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums"
                        style={{
                          backgroundColor: fdrBg(Math.round(teamAvgUpcomingFdr[team.id])),
                          color: fdrText(Math.round(teamAvgUpcomingFdr[team.id])),
                        }}
                      >
                        {teamAvgUpcomingFdr[team.id].toFixed(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* FDR legend below the grid */}
          <div className="flex items-center gap-3 px-3 py-2 text-[10px] text-gray-500 border-t border-[#1a1a1a]">
            <span>FDR:</span>
            {[1, 2, 3, 4, 5].map((fdr) => (
              <span
                key={fdr}
                className="px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: fdrBg(fdr), color: fdrText(fdr) }}
              >
                {fdr}
              </span>
            ))}
            <span className="ml-1">1 = easiest, 5 = hardest</span>
          </div>
        </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PPDU Standings tab                                                  */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "ppdu" && (
        <div>
          {/* Explainer */}
          <p className="text-xs text-gray-500 mb-3">
            PPDU (Points Per Difficulty Unit) adjusts league standings by fixture
            difficulty. Teams that earned their points against tougher opposition
            rank higher. This is for context only and does not affect composite scoring.
          </p>

          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-center py-2 px-2 w-8">#</th>
                  <th className="text-left py-2 px-3">Team</th>
                  <th className="text-center py-2 px-2">
                    <Tooltip text="Games played so far this season">P</Tooltip>
                  </th>
                  <th className="text-center py-2 px-2">
                    <Tooltip text="Wins">W</Tooltip>
                  </th>
                  <th className="text-center py-2 px-2">
                    <Tooltip text="Draws">D</Tooltip>
                  </th>
                  <th className="text-center py-2 px-2">
                    <Tooltip text="Losses">L</Tooltip>
                  </th>
                  <th className="text-right py-2 px-2">
                    <Tooltip text="Premier League points (W*3 + D)">Pts</Tooltip>
                  </th>
                  <th className="text-right py-2 px-2">
                    <Tooltip text="Average FDR of completed fixtures. Higher = harder schedule faced so far.">Avg FDR</Tooltip>
                  </th>
                  <th className="py-2 px-3 min-w-[140px]">
                    <Tooltip text="Points Per Difficulty Unit = PL Points / Mean FDR. Higher = better performance relative to difficulty.">PPDU</Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ppduStandings.map((team, idx) => (
                  <tr key={team.teamId} className="border-t border-[#1a1a1a] hover:bg-[#1a1a1a]">
                    {/* Rank */}
                    <td className="text-center py-2 px-2 text-gray-500 tabular-nums">
                      {idx + 1}
                    </td>
                    {/* Team name */}
                    <td className="py-2 px-3 font-medium">{team.teamName}</td>
                    {/* Played */}
                    <td className="text-center py-2 px-2 tabular-nums">{team.played}</td>
                    {/* W / D / L */}
                    <td className="text-center py-2 px-2 tabular-nums text-green-400">{team.wins}</td>
                    <td className="text-center py-2 px-2 tabular-nums text-gray-400">{team.draws}</td>
                    <td className="text-center py-2 px-2 tabular-nums text-red-400">{team.losses}</td>
                    {/* PL Points */}
                    <td className="text-right py-2 px-2 tabular-nums font-semibold">{team.plPoints}</td>
                    {/* Average FDR -- color-coded */}
                    <td className="text-right py-2 px-2">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums"
                        style={{
                          backgroundColor: fdrBg(Math.round(team.meanFdr)),
                          color: fdrText(Math.round(team.meanFdr)),
                        }}
                      >
                        {team.meanFdr.toFixed(2)}
                      </span>
                    </td>
                    {/* PPDU with inline bar */}
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold tabular-nums text-cyan-400 min-w-[36px] text-right">
                          {team.ppdu.toFixed(1)}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-[#222] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-cyan-500/60"
                            style={{ width: `${ppduBarWidth(team.ppdu, maxPpdu)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FDR legend */}
          <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
            <span>FDR scale:</span>
            {[1, 2, 3, 4, 5].map((fdr) => (
              <span
                key={fdr}
                className="px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: fdrBg(fdr), color: fdrText(fdr) }}
              >
                {fdr}
              </span>
            ))}
            <span className="ml-1">1 = easiest, 5 = hardest</span>
          </div>

          {/* Export buttons for PPDU standings data.
              Passes upcomingByTeam and gwRange so the export includes
              future FDRs alongside the backward-looking PPDU data. */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => exportPpduCsv(ppduStandings, upcomingByTeam, gwRange)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[#222] text-gray-300 hover:bg-[#333] transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={() => exportPpduJson(ppduStandings, upcomingByTeam, gwRange)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[#222] text-gray-300 hover:bg-[#333] transition-colors"
            >
              Export JSON
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Fixture Pairings tab                                                */}
      {/* Shows team pairs with complementary fixture schedules.              */}
      {/* When one team has hard games, the other has easy ones.              */}
      {/* Ranked by alternation quality score (0-100).                       */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === "pairings" && (
        <div>
          {/* Explainer */}
          <p className="text-xs text-gray-500 mb-3">
            Teams whose fixtures alternate: when one has hard games, the other has easy
            ones. Own players from both to always have someone on a green run. Higher
            alternation score = better complementary schedules.
          </p>

          {/* Horizon selector */}
          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-gray-400">Horizon:</label>
            {[3, 5, 8, 10].map((h) => (
              <button
                key={h}
                onClick={() => setPairingHorizon(h)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  pairingHorizon === h
                    ? "bg-[#333] text-white"
                    : "bg-[#111] text-gray-400 hover:bg-[#1a1a1a]"
                }`}
              >
                {h} GWs
              </button>
            ))}
          </div>

          {/* Pairings table: top 15 pairs */}
          <div className="space-y-3">
            {pairings.slice(0, 15).map((pair, idx) => (
              <div
                key={`${pair.teamA.id}-${pair.teamB.id}`}
                className="rounded-lg p-3"
                style={{ backgroundColor: "#111", border: "1px solid #222" }}
              >
                {/* Header: rank, team names, alternation score */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 tabular-nums w-5">{idx + 1}.</span>
                    <span className="text-sm font-semibold">{pair.teamA.shortName}</span>
                    <span className="text-xs text-gray-500">+</span>
                    <span className="text-sm font-semibold">{pair.teamB.shortName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Average best FDR when always picking the easier fixture */}
                    <Tooltip text={`When always starting the player with the easier fixture, average FDR is ${pair.avgBestFdr}. Lower = easier combined schedule.`}>
                      <span className="text-[10px] text-gray-400">
                        Avg best: <span
                          className="font-bold px-1 py-0.5 rounded"
                          style={{
                            backgroundColor: fdrBg(Math.round(pair.avgBestFdr)),
                            color: fdrText(Math.round(pair.avgBestFdr)),
                          }}
                        >
                          {pair.avgBestFdr}
                        </span>
                      </span>
                    </Tooltip>
                    {/* Alternation score badge */}
                    <Tooltip text={`Alternation quality: ${pair.alternationScore}/100. Higher = fixtures alternate better (one easy when other is hard). Based on inverse FDR correlation (${pair.correlation}) and average best-available difficulty.`}>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        pair.alternationScore >= 70 ? "bg-green-500/20 text-green-400" :
                        pair.alternationScore >= 50 ? "bg-cyan-500/20 text-cyan-400" :
                        "bg-gray-500/20 text-gray-400"
                      }`}>
                        {pair.alternationScore}
                      </span>
                    </Tooltip>
                  </div>
                </div>

                {/* Week-by-week breakdown: shows both teams' FDRs and which to start */}
                <div className="flex gap-1">
                  {pair.weekByWeek.map((week) => (
                    <div key={week.gw} className="flex-1 text-center">
                      {/* GW label */}
                      <div className="text-[9px] text-gray-600 mb-0.5">GW{week.gw}</div>
                      {/* Team A's FDR with opponent */}
                      <div
                        className={`text-[10px] font-bold px-1 py-0.5 rounded mb-0.5 leading-tight ${
                          week.pick === "A" ? "ring-1 ring-white/30" : "opacity-50"
                        }`}
                        style={{
                          backgroundColor: fdrBg(Math.round(week.fdrA)),
                          color: fdrText(Math.round(week.fdrA)),
                        }}
                        title={`${pair.teamA.shortName}: ${week.oppA || "FDR " + week.fdrA}`}
                      >
                        <div>{week.oppA?.split(" ")[0] || pair.teamA.shortName}</div>
                        <div className="text-[8px] font-normal opacity-80">{week.oppA?.includes("(") ? week.oppA.split(" ").pop() : ""}</div>
                      </div>
                      {/* Team B's FDR with opponent */}
                      <div
                        className={`text-[10px] font-bold px-1 py-0.5 rounded leading-tight ${
                          week.pick === "B" ? "ring-1 ring-white/30" : "opacity-50"
                        }`}
                        style={{
                          backgroundColor: fdrBg(Math.round(week.fdrB)),
                          color: fdrText(Math.round(week.fdrB)),
                        }}
                        title={`${pair.teamB.shortName}: ${week.oppB || "FDR " + week.fdrB}`}
                      >
                        <div>{week.oppB?.split(" ")[0] || pair.teamB.shortName}</div>
                        <div className="text-[8px] font-normal opacity-80">{week.oppB?.includes("(") ? week.oppB.split(" ").pop() : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {pairings.length === 0 && (
            <div className="text-center text-gray-500 py-8 text-sm">
              No fixture data available for pairing analysis.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
