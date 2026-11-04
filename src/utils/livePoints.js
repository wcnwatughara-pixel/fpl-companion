/**
 * livePoints.js -- Fetch and merge per-player GW points
 *
 * The FPL API provides a live endpoint for each gameweek:
 *   /api/event/{gw}/live/
 *
 * This returns every player's points breakdown for that specific GW,
 * including bonus points, minutes played, goals, assists, etc.
 *
 * We use this to show per-player GW points on the Dashboard (PlayerCard)
 * and in the player detail view.
 *
 * In development, requests go through Vite's dev proxy. In production
 * (GitHub Pages), they go through a CORS proxy since the FPL API
 * doesn't allow direct cross-origin browser requests.
 *
 * The endpoint returns:
 *   { elements: [ { id: 1, stats: { total_points: 7, minutes: 90, ... } }, ... ] }
 */

// ---------------------------------------------------------------------------
// API base URL (shared pattern with fplApi.js)
// ---------------------------------------------------------------------------

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
// Fetch live/completed GW points
// ---------------------------------------------------------------------------

/**
 * Fetch live or completed GW points for all players.
 *
 * @param {number} gw - The gameweek number to fetch
 * @returns {Object} - Map of playerId -> { gwPoints, gwMinutes, gwGoals, gwAssists, gwCleanSheets, gwBonus }
 *   Returns empty object if fetch fails (non-blocking -- the app works without GW points)
 */
export async function fetchLivePoints(gw) {
  if (!gw || gw < 1) return {};

  try {
    const res = await fetch(fplUrl(`/event/${gw}/live/`));
    if (!res.ok) {
      console.warn(`[livePoints] Failed to fetch GW${gw} live data: ${res.status}`);
      return {};
    }

    const data = await res.json();
    if (!data.elements?.length) return {};

    // Build a lookup map: playerId -> key stats for this GW
    const pointsMap = {};
    for (const el of data.elements) {
      const s = el.stats || {};
      pointsMap[el.id] = {
        gwPoints: s.total_points ?? 0,
        gwMinutes: s.minutes ?? 0,
        gwGoals: (s.goals_scored ?? 0),
        gwAssists: (s.assists ?? 0),
        gwCleanSheets: (s.clean_sheets ?? 0),
        gwBonus: (s.bonus ?? 0),
      };
    }

    return pointsMap;
  } catch (err) {
    // Non-blocking: if live data isn't available, the app still works.
    // GW points will simply not be shown.
    console.warn(`[livePoints] Error fetching GW${gw} live data:`, err.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Merge GW points onto player objects
// ---------------------------------------------------------------------------

/**
 * Attach per-player GW points to the player array.
 * Non-destructive: players without GW data get gwPoints = null
 * so the UI can distinguish "no data" from "0 points".
 *
 * @param {Array} players - The full player array
 * @param {Object} livePointsMap - Map from fetchLivePoints()
 * @returns {Array} - Players with gwPoints, gwMinutes, gwGoals, gwAssists, gwCleanSheets, gwBonus attached
 */
export function mergeLivePoints(players, livePointsMap) {
  if (!livePointsMap || !Object.keys(livePointsMap).length) {
    // No live data available -- set gwPoints to null so UI shows "-" not "0"
    return players.map((p) => ({
      ...p,
      gwPoints: null,
      gwMinutes: null,
      gwGoals: null,
      gwAssists: null,
      gwCleanSheets: null,
      gwBonus: null,
    }));
  }

  return players.map((p) => {
    const live = livePointsMap[p.id];
    if (!live) {
      return { ...p, gwPoints: null, gwMinutes: null, gwGoals: null, gwAssists: null, gwCleanSheets: null, gwBonus: null };
    }
    return {
      ...p,
      gwPoints: live.gwPoints,
      gwMinutes: live.gwMinutes,
      gwGoals: live.gwGoals,
      gwAssists: live.gwAssists,
      gwCleanSheets: live.gwCleanSheets,
      gwBonus: live.gwBonus,
    };
  });
}
