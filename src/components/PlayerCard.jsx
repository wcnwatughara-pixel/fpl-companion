/**
 * PlayerCard.jsx -- Compact player info card
 *
 * Used in the Dashboard (My Squad) view to show each player in the squad.
 * Shows key info at a glance: name, team, position, price, form, points,
 * injury status, and a mini composite score bar.
 *
 * Stat labels have hover tooltips explaining what each metric means.
 *
 * Feature 7: Next 5 fixtures displayed via FixtureMiniRow after the score bar.
 */

import ScoreBar from "./ScoreBar.jsx";
import { FixtureMiniRow } from "./FixtureGrid.jsx";
import Tooltip from "./Tooltip.jsx";
import { formatPrice, getStatusInfo } from "../utils/formatters.js";
import { getMetric } from "../data/metricDefinitions.js";

export default function PlayerCard({ player, onClick }) {
  const statusInfo = getStatusInfo(player.status);
  const isAvailable = player.status === "a";

  return (
    <div
      onClick={() => onClick?.(player)}
      className="rounded-lg p-3 cursor-pointer transition-colors hover:bg-[#1a1a2e]"
      style={{
        backgroundColor: "#111111",
        border: "1px solid #222",
      }}
    >
      {/* Top row: name + position badge */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Position badge */}
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor:
                player.position_name === "GKP" ? "#f59e0b" :
                player.position_name === "DEF" ? "#22c55e" :
                player.position_name === "MID" ? "#3b82f6" :
                "#ef4444",
              color: "#000",
            }}
          >
            {player.position_name}
          </span>
          {/* Player name */}
          <span className="font-semibold text-sm">{player.web_name}</span>
        </div>
        {/* Price */}
        <span className="text-xs text-gray-400 tabular-nums">
          {formatPrice(player.price)}m
        </span>
      </div>

      {/* Middle row: team + status */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">{player.team_name}</span>
        {/* Show status/availability */}
        <div className="flex items-center gap-1.5">
          {/* Availability percentage when not fully fit */}
          {player.chance_of_playing < 100 && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
              {player.chance_of_playing}% avail
            </span>
          )}
          {!isAvailable && (
            <span className="text-[10px] font-medium" style={{ color: statusInfo.color }}>
              {statusInfo.label}
            </span>
          )}
        </div>
      </div>

      {/* Stats row -- 4 columns when GW points available, 3 otherwise */}
      <div className={`grid ${player.gwPoints != null ? "grid-cols-4" : "grid-cols-3"} gap-2 mb-2 text-center`}>
        {/* GW points: highlighted in green/red based on whether above/below average.
            Only shown when live data has been fetched (gwPoints !== null). */}
        {player.gwPoints != null && (
          <div>
            <div className="text-[10px] text-gray-500">
              <Tooltip text="Points scored in the current/most recent gameweek">GW</Tooltip>
            </div>
            <div className={`text-xs font-bold tabular-nums ${
              player.gwPoints >= 6 ? "text-green-400" :
              player.gwPoints >= 2 ? "text-gray-200" :
              "text-red-400"
            }`}>
              {player.gwPoints}
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-gray-500">
            <Tooltip text={getMetric("form").short}>Form</Tooltip>
          </div>
          <div className="text-xs font-semibold tabular-nums">{player.form_num.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500">
            <Tooltip text={getMetric("totalPlayerPoints").short}>Points</Tooltip>
          </div>
          <div className="text-xs font-semibold tabular-nums">{player.total_points}</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500">
            <Tooltip text={getMetric("ptsPer90").short}>Pts/90</Tooltip>
          </div>
          <div className="text-xs font-semibold tabular-nums">{player.pts_per_90.toFixed(1)}</div>
        </div>
      </div>

      {/* Composite score bar */}
      {player.compositeScore != null && (
        <ScoreBar score={player.compositeScore} />
      )}

      {/* Feature 7: Next 5 fixtures mini row */}
      {player.upcoming_fixtures?.length > 0 && (
        <div className="mt-1.5">
          <FixtureMiniRow fixtures={player.upcoming_fixtures.slice(0, 5)} />
        </div>
      )}

      {/* Injury news if any */}
      {player.news && (
        <p className="text-[10px] text-gray-500 mt-1.5 truncate" title={player.news}>
          {player.news}
        </p>
      )}
    </div>
  );
}
