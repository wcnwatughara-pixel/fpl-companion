/**
 * fplApi.js -- FPL API fetch layer
 *
 * All requests go through Vite's dev server proxy (/api/...),
 * which forwards them to https://fantasy.premierleague.com/api/...
 * This avoids CORS errors because the browser only talks to localhost.
 *
 * Features:
 * - Automatic retry with exponential backoff (3 attempts)
 * - localStorage caching so we don't hammer the API on every page load
 * - Sequential fetching (one request at a time) to respect rate limits
 * - Manual "refresh" clears cache and re-fetches everything
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pause execution for a given number of milliseconds.
 * Used between retries and between sequential API calls.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL with retry logic.
 * If the request fails, wait progressively longer before retrying:
 *   attempt 1 failure -> wait 1s
 *   attempt 2 failure -> wait 2s
 *   attempt 3 failure -> give up and throw
 *
 * @param {string} url - The URL to fetch (should start with /api/)
 * @param {number} retries - How many times to retry on failure (default 3)
 * @returns {Promise<any>} - Parsed JSON response
 */
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);

      // If the server returns an error status, treat it as a failure
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      // If we've used all our retries, give up
      if (attempt === retries) {
        throw new Error(
          `Failed to fetch ${url} after ${retries} attempts: ${error.message}`
        );
      }

      // Wait before retrying (1s, then 2s, then 3s, etc.)
      console.warn(
        `Attempt ${attempt}/${retries} failed for ${url}. Retrying in ${attempt}s...`
      );
      await sleep(attempt * 1000);
    }
  }
}

// ---------------------------------------------------------------------------
// localStorage cache helpers
// ---------------------------------------------------------------------------

/**
 * Save data to localStorage under a given key.
 * Wraps the data with a timestamp so we know when it was cached.
 */
function cacheSet(key, data) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (e) {
    // localStorage might be full or unavailable -- not critical
    console.warn(`Cache write failed for ${key}:`, e.message);
  }
}

/**
 * Read data from localStorage.
 * Returns the cached data, or null if nothing is cached for that key.
 */
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear all FPL-related cache entries (but keep the team ID).
 * Called when the user clicks "Refresh Data".
 */
function cacheClear() {
  const keysToRemove = [
    "fpl_bootstrap",
    "fpl_fixtures",
    "fpl_entry",
    "fpl_picks",       // legacy single-key cache
    "fpl_last_updated",
  ];
  keysToRemove.forEach((key) => localStorage.removeItem(key));

  // Also clear per-GW picks caches (fpl_picks_gw1, fpl_picks_gw2, ...)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("fpl_picks_gw")) {
      localStorage.removeItem(key);
      i--; // removeItem shifts the indices, so step back
    }
  }
}

// ---------------------------------------------------------------------------
// Individual API fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch the "bootstrap-static" endpoint.
 * This is the big one -- it returns ALL players, ALL teams, gameweek info,
 * game settings, and more. One call, ~2MB of JSON.
 *
 * @param {boolean} skipCache - If true, ignore cached data and fetch fresh
 * @returns {Promise<Object>} - The full bootstrap-static response
 */
export async function fetchBootstrap(skipCache = false) {
  if (!skipCache) {
    const cached = cacheGet("fpl_bootstrap");
    if (cached) return cached;
  }

  const data = await fetchWithRetry("/api/bootstrap-static/");
  cacheSet("fpl_bootstrap", data);
  return data;
}

/**
 * Fetch all fixtures for the season.
 * Each fixture has: home team, away team, FDR ratings, scores, gameweek, etc.
 *
 * @param {boolean} skipCache - If true, ignore cached data
 * @returns {Promise<Array>} - Array of fixture objects
 */
export async function fetchFixtures(skipCache = false) {
  if (!skipCache) {
    const cached = cacheGet("fpl_fixtures");
    if (cached) return cached;
  }

  const data = await fetchWithRetry("/api/fixtures/");
  cacheSet("fpl_fixtures", data);
  return data;
}

/**
 * Fetch a user's team entry (overall info like rank, points, squad value).
 *
 * @param {string|number} teamId - The user's FPL team ID
 * @param {boolean} skipCache - If true, ignore cached data
 * @returns {Promise<Object>} - Entry object with team summary
 */
export async function fetchEntry(teamId, skipCache = false) {
  if (!skipCache) {
    const cached = cacheGet("fpl_entry");
    if (cached) return cached;
  }

  const data = await fetchWithRetry(`/api/entry/${teamId}/`);
  cacheSet("fpl_entry", data);
  return data;
}

/**
 * Fetch the user's picks (squad selection) for a specific gameweek.
 * Returns which 15 players they picked, who is captain, bench order, etc.
 *
 * @param {string|number} teamId - The user's FPL team ID
 * @param {number} gameweek - Which gameweek to fetch picks for
 * @param {boolean} skipCache - If true, ignore cached data
 * @returns {Promise<Object>} - Picks object with array of player selections
 */
export async function fetchPicks(teamId, gameweek, skipCache = false) {
  // Cache key includes the GW so switching between GWs doesn't serve stale data.
  // Old single-key "fpl_picks" is cleared on refresh via cacheClear().
  const cacheKey = `fpl_picks_gw${gameweek}`;
  if (!skipCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const data = await fetchWithRetry(
    `/api/entry/${teamId}/event/${gameweek}/picks/`
  );
  cacheSet(cacheKey, data);
  return data;
}

// ---------------------------------------------------------------------------
// Orchestration: load everything at once
// ---------------------------------------------------------------------------

/**
 * Load all required data for the app.
 * Calls each endpoint sequentially (with a 300ms gap between calls)
 * to avoid overwhelming the FPL API.
 *
 * @param {string|number} teamId - The user's FPL team ID
 * @param {number} currentGw - The current gameweek number
 * @param {boolean} forceRefresh - If true, clear cache and fetch fresh data
 * @returns {Promise<Object>} - { bootstrap, fixtures, entry, picks }
 */
export async function loadAllData(teamId, currentGw, forceRefresh = false) {
  if (forceRefresh) {
    cacheClear();
  }

  // Fetch sequentially with small delays to be polite to the API
  const bootstrap = await fetchBootstrap(forceRefresh);
  await sleep(300);

  const fixtures = await fetchFixtures(forceRefresh);
  await sleep(300);

  const entry = await fetchEntry(teamId, forceRefresh);
  await sleep(300);

  // For picks, we need the most recently completed or current gameweek.
  // If no GW has finished yet, picks won't be available.
  let picks = null;
  if (currentGw >= 1) {
    try {
      picks = await fetchPicks(teamId, currentGw, forceRefresh);
    } catch (err) {
      // Picks might not be available yet (e.g., before GW1).
      // That's okay -- the app can still work without them.
      console.warn("Could not fetch picks:", err.message);
    }
  }

  // Record when we last refreshed
  localStorage.setItem("fpl_last_updated", new Date().toISOString());

  return { bootstrap, fixtures, entry, picks };
}

// ---------------------------------------------------------------------------
// Team ID management
// ---------------------------------------------------------------------------

/**
 * Save the user's FPL team ID to localStorage.
 * @param {string|number} teamId
 */
export function saveTeamId(teamId) {
  localStorage.setItem("fpl_team_id", String(teamId));
}

/**
 * Read the saved team ID from localStorage.
 * @returns {string|null} - The saved team ID, or null if not set
 */
export function getTeamId() {
  return localStorage.getItem("fpl_team_id");
}

/**
 * Get the timestamp of the last data refresh.
 * @returns {string|null} - ISO timestamp, or null if never refreshed
 */
export function getLastUpdated() {
  return localStorage.getItem("fpl_last_updated");
}
