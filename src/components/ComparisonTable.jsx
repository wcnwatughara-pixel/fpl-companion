/**
 * ComparisonTable.jsx -- Side-by-side player comparison
 *
 * Takes 2-4 selected players and displays their stats in a table
 * where each column is a player. Makes it easy to compare players
 * at a glance. Used on the Compare page.
 */

import { formatPrice, formatDecimal, formatPercent } from "../utils/formatters.js";
import { FixtureMiniRow } from "./FixtureGrid.jsx";
import ScoreBar from "./ScoreBar.jsx";
import Tooltip from "./Tooltip.jsx";
import { getMetric } from "../data/metricDefinitions.js";

/**
 * The rows we display in the comparison table.
 * Each row has a label, a metricKey for tooltips, and a function to extract the value from a player.
 */
const STAT_ROWS = [
  { label: "Position",     metricKey: null,                getValue: (p) => p.position_name },
  { label: "Team",         metricKey: null,                getValue: (p) => p.team_name },
  { label: "Price",        metricKey: "price",             getValue: (p) => `${formatPrice(p.price)}m` },
  { label: "Form",         metricKey: "form",              getValue: (p) => formatDecimal(p.form_num) },
  { label: "Total Points", metricKey: "totalPlayerPoints", getValue: (p) => p.total_points },
  { label: "GW Points",   metricKey: "gwPoints",          getValue: (p) => p.gwPoints ?? "—" },
  { label: "Pts/90",       metricKey: "ptsPer90",          getValue: (p) => formatDecimal(p.pts_per_90) },
  { label: "ICT Index",    metricKey: "ictIndex",          getValue: (p) => formatDecimal(p.ict_num) },
  { label: "xG",           metricKey: "xg",                getValue: (p) => formatDecimal(p.xg) },
  { label: "xA",           metricKey: "xa",                getValue: (p) => formatDecimal(p.xa) },
  { label: "xGI",          metricKey: "xgi",               getValue: (p) => formatDecimal(p.xgi) },
  { label: "xGI/90",       metricKey: "xgiPer90",          getValue: (p) => formatDecimal(p.xgi_per_90) },
  { label: "xGC/90",       metricKey: "xgcPer90",          getValue: (p) => formatDecimal(p.xgc_per_90), invert: true },
  { label: "Clean Sheets", metricKey: "cleanSheets",       getValue: (p) => p.clean_sheets },
  { label: "Minutes",      metricKey: "minutes",           getValue: (p) => p.minutes },
  { label: "Ownership",    metricKey: "ownership",         getValue: (p) => formatPercent(p.ownership) },
  { label: "Availability", metricKey: "availability",      getValue: (p) => `${p.chance_of_playing ?? 100}%` },
  { label: "Status",       metricKey: "status",            getValue: (p) => p.status === "a" ? "Available" : p.news || "Unavailable" },
];

export default function ComparisonTable({ players, onRemovePlayer }) {
  if (!players || players.length === 0) {
    return (
      <p className="text-gray-500 text-sm text-center py-8">
        Search for players above to compare them side by side.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-gray-400 text-xs font-medium w-28">
              Stat
            </th>
            {players.map((player) => (
              <th key={player.id} className="py-2 px-3 text-center min-w-[120px]">
                <div className="flex flex-col items-center gap-1">
                  <span className="font-semibold text-sm">{player.web_name}</span>
                  {/* Remove button */}
                  <button
                    onClick={() => onRemovePlayer?.(player.id)}
                    className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Stat rows */}
          {STAT_ROWS.map((row) => (
            <tr key={row.label} className="border-t border-[#1a1a1a]">
              <td className="py-2 px-3 text-gray-400 text-xs font-medium">
                {row.metricKey ? (
                  <Tooltip text={getMetric(row.metricKey).short}>{row.label}</Tooltip>
                ) : (
                  row.label
                )}
              </td>
              {players.map((player) => {
                const val = row.getValue(player);
                // Highlight the best value in green (for numeric stats)
                const allVals = players.map((p) => row.getValue(p));
                const isBest =
                  typeof val === "number" &&
                  val === Math.max(...allVals.filter((v) => typeof v === "number"));

                return (
                  <td
                    key={player.id}
                    className="py-2 px-3 text-center tabular-nums text-xs"
                    style={{ color: isBest ? "#22c55e" : undefined }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* Composite score row */}
          <tr className="border-t border-[#1a1a1a]">
            <td className="py-2 px-3 text-gray-400 text-xs font-medium">
              <Tooltip text={getMetric("compositeScore").short}>Composite Score</Tooltip>
            </td>
            {players.map((player) => (
              <td key={player.id} className="py-2 px-3">
                <ScoreBar score={player.compositeScore || 0} />
              </td>
            ))}
          </tr>

          {/* Projected points row */}
          <tr className="border-t border-[#1a1a1a]">
            <td className="py-2 px-3 text-gray-400 text-xs font-medium">
              <Tooltip text={getMetric("projectedPoints").short}>Projected Pts</Tooltip>
            </td>
            {players.map((player) => {
              const val = player.projectedPoints ?? 0;
              const allVals = players.map((p) => p.projectedPoints ?? 0);
              const isBest = val === Math.max(...allVals) && val > 0;
              return (
                <td
                  key={player.id}
                  className="py-2 px-3 text-center tabular-nums text-sm font-semibold"
                  style={{ color: isBest ? "#a855f7" : "#9ca3af" }}
                >
                  {val.toFixed(1)}
                </td>
              );
            })}
          </tr>

          {/* Upcoming fixtures row */}
          <tr className="border-t border-[#1a1a1a]">
            <td className="py-2 px-3 text-gray-400 text-xs font-medium">
              <Tooltip text={getMetric("next5Fixtures").short}>Next 5 Fixtures</Tooltip>
            </td>
            {players.map((player) => (
              <td key={player.id} className="py-2 px-3">
                <FixtureMiniRow
                  fixtures={player.upcoming_fixtures?.slice(0, 5)}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
