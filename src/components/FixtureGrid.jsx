/**
 * FixtureGrid.jsx -- Colour-coded fixture difficulty grid
 *
 * Shows all 20 teams vs. the next several gameweeks.
 * Each cell is colour-coded by difficulty (green = easy, red = hard).
 * This component is used both on the Fixtures page (full grid)
 * and as a mini-row in other views (showing one player's fixtures).
 */

import { getFdrColor } from "../utils/fdrCalc.js";

// ---------------------------------------------------------------------------
// Mini fixture row (used inline in comparisons and player cards)
// ---------------------------------------------------------------------------

/**
 * A compact row of fixture badges for a single player/team.
 * Shows opponent abbreviation with colour-coded background.
 *
 * @param {Array} fixtures - Array of { opponent, is_home, fdr, gw }
 */
export function FixtureMiniRow({ fixtures }) {
  if (!fixtures || fixtures.length === 0) {
    return <span className="text-xs text-gray-500">No fixtures</span>;
  }

  return (
    <div className="flex gap-1">
      {fixtures.map((f, i) => {
        const colors = getFdrColor(f.fdr);
        return (
          <div
            key={i}
            className="flex flex-col items-center rounded px-1.5 py-0.5 min-w-[2.5rem]"
            style={{ backgroundColor: colors.bg, color: colors.text }}
            title={`GW${f.gw}: ${f.opponent} (${f.is_home ? "H" : "A"}) - FDR ${f.fdr}`}
          >
            <span className="text-[10px] font-bold leading-tight">
              {f.opponent}
            </span>
            <span className="text-[8px] leading-tight">
              {f.is_home ? "(H)" : "(A)"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full fixture grid (used on the Fixtures page)
// ---------------------------------------------------------------------------

/**
 * The full 20-team fixture grid.
 * Each row is a team, each column is a gameweek.
 *
 * @param {Array} gridData - From buildFdrGrid() in fdrCalc.js
 * @param {number} startGw - First GW number in the grid
 * @param {number} count - How many GW columns to show
 * @param {Function} onTeamClick - Called when a team row is clicked
 */
export default function FixtureGrid({ gridData, startGw, count = 6, onTeamClick }) {
  if (!gridData || gridData.length === 0) {
    return <p className="text-gray-500 text-sm">No fixture data available.</p>;
  }

  // Build column headers: GW6, GW7, GW8, etc.
  const gwHeaders = [];
  for (let i = 0; i < count; i++) {
    gwHeaders.push(startGw + i);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-gray-400 text-xs font-medium sticky left-0 bg-[#0a0a0a] z-10">
              Team
            </th>
            {gwHeaders.map((gw) => (
              <th
                key={gw}
                className="py-2 px-2 text-gray-400 text-xs font-medium text-center"
              >
                GW{gw}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gridData.map((row) => (
            <tr
              key={row.teamId}
              className="cursor-pointer hover:bg-[#1a1a1a] transition-colors"
              onClick={() => onTeamClick?.(row)}
            >
              {/* Team name */}
              <td className="py-1.5 px-3 font-medium text-xs sticky left-0 bg-[#0a0a0a] z-10">
                {row.shortName}
              </td>
              {/* Fixture cells */}
              {row.fixtures.map((fixture, i) => {
                const colors = getFdrColor(fixture.fdr);
                return (
                  <td key={i} className="py-1 px-1 text-center">
                    <div
                      className="rounded px-1.5 py-1 inline-block min-w-[3rem]"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                      }}
                      title={`FDR ${fixture.fdr}`}
                    >
                      <div className="text-xs font-bold leading-tight">
                        {fixture.opponent}
                      </div>
                      <div className="text-[9px] leading-tight">
                        {fixture.is_home === null ? "" : fixture.is_home ? "(H)" : "(A)"}
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
