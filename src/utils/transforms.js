/**
 * transforms.js -- Data normalisation
 *
 * The FPL API returns many numeric values as strings (form, ict_index,
 * expected_goals, etc.). This module converts them to proper numbers
 * and attaches human-readable labels (position name, team name).
 *
 * It also builds per-player fixture lists so we know what games
 * each player has coming up in the next several gameweeks.
 */

// ---------------------------------------------------------------------------
// Position mapping
// ---------------------------------------------------------------------------

/**
 * Map the API's element_type number to a short position label.
 * 1 = Goalkeeper, 2 = Defender, 3 = Midfielder, 4 = Forward
 */
const POSITION_MAP = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

// ---------------------------------------------------------------------------
// Player normalisation
// ---------------------------------------------------------------------------

/**
 * Take the raw player object from the API and add computed/normalised fields.
 *
 * @param {Object} rawPlayer - A single element from bootstrap.elements
 * @param {Object} teamsById - Lookup map: team ID -> team object
 * @param {Array} upcomingFixtures - Pre-built fixture list for this player's team
 * @returns {Object} - The player object with extra normalised fields added
 */
export function normalisePlayer(rawPlayer, teamsById, upcomingFixtures) {
  const team = teamsById[rawPlayer.team] || {};

  // Parse all the string-typed numeric fields into actual numbers
  const form_num = parseFloat(rawPlayer.form) || 0;
  const ict_num = parseFloat(rawPlayer.ict_index) || 0;
  const xg = parseFloat(rawPlayer.expected_goals) || 0;
  const xa = parseFloat(rawPlayer.expected_assists) || 0;
  const xgi = parseFloat(rawPlayer.expected_goal_involvements) || 0;
  const xgc = parseFloat(rawPlayer.expected_goals_conceded) || 0;
  const ownership = parseFloat(rawPlayer.selected_by_percent) || 0;
  const ppg = parseFloat(rawPlayer.points_per_game) || 0;

  // Availability: the API returns null when fully fit, 0-100 otherwise.
  // We normalise to 0-100 where 100 = fully available.
  const chance_of_playing = rawPlayer.chance_of_playing_next_round != null
    ? rawPlayer.chance_of_playing_next_round
    : 100; // null means fully available

  // Calculate points per 90 minutes.
  // If the player has played fewer than 45 minutes total, we can't
  // get a meaningful per-90 figure, so default to 0.
  const minutes = rawPlayer.minutes || 0;
  const pts_per_90 = minutes >= 45
    ? (rawPlayer.total_points / (minutes / 90))
    : 0;

  // xGI per 90 -- use the API's own per-90 field if available,
  // otherwise compute it ourselves.
  // parseFloat() is needed because the API sometimes returns numeric strings
  // and the ?? operator only catches null/undefined, not strings like "0.34".
  const rawXgiPer90 = rawPlayer.expected_goal_involvements_per_90;
  const xgi_per_90 = rawXgiPer90 != null
    ? (parseFloat(rawXgiPer90) || 0)
    : (minutes >= 45 ? (xgi / (minutes / 90)) : 0);

  // xGC per 90 -- expected goals conceded per 90 minutes.
  // Lower is better (defensive solidity). Only meaningful for GKP/DEF
  // but we compute for everyone and let the scoring algorithm decide.
  const rawXgcPer90 = rawPlayer.expected_goals_conceded_per_90;
  const xgc_per_90 = rawXgcPer90 != null
    ? (parseFloat(rawXgcPer90) || 0)
    : (minutes >= 45 ? (xgc / (minutes / 90)) : 0);

  // Get the fixture list for this player's team
  const teamFixtures = upcomingFixtures[rawPlayer.team] || [];

  return {
    ...rawPlayer,
    // Normalised numbers
    price: rawPlayer.now_cost / 10,
    form_num,
    ict_num,
    xg,
    xa,
    xgi,
    xgc,
    xgi_per_90,
    xgc_per_90,
    pts_per_90,
    ppg,
    ownership,
    // Availability: 0-100 (100 = fully fit, 0 = ruled out)
    chance_of_playing,
    // Clean sheet count (used for defensive contribution context)
    clean_sheets: rawPlayer.clean_sheets || 0,
    // Human-readable labels
    position_name: POSITION_MAP[rawPlayer.element_type] || "???",
    team_name: team.short_name || "???",
    team_full_name: team.name || "Unknown",
    // Upcoming fixtures for this player's team
    upcoming_fixtures: teamFixtures,
    upcoming_fdr: teamFixtures.map((f) => f.fdr),
  };
}

// ---------------------------------------------------------------------------
// Team lookup builder
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from team ID to team object.
 * Makes it easy to go from a player's `team` field to the team's name.
 *
 * @param {Array} teams - The `teams` array from bootstrap-static
 * @returns {Object} - { [teamId]: teamObject }
 */
export function buildTeamsById(teams) {
  const map = {};
  for (const team of teams) {
    map[team.id] = team;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Upcoming fixtures builder
// ---------------------------------------------------------------------------

/**
 * Build a map of upcoming fixtures per team.
 * For each of the 20 teams, produces an array of the next N gameweeks'
 * fixtures, each with opponent, home/away, and FDR rating.
 *
 * @param {Array} fixtures - The full fixtures array from the API
 * @param {Object} teamsById - Lookup map from buildTeamsById()
 * @param {number} currentGw - The current (or next upcoming) gameweek number
 * @param {number} lookAhead - How many future GWs to include (default 6)
 * @returns {Object} - { [teamId]: [{ gw, opponent, opponent_full, is_home, fdr }] }
 */
export function buildUpcomingFixtures(fixtures, teamsById, currentGw, lookAhead = 6) {
  const result = {};

  // Filter to only future gameweeks within our look-ahead window
  const futureFixtures = fixtures.filter((f) => {
    return f.event != null && f.event >= currentGw && f.event < currentGw + lookAhead;
  });

  for (const fixture of futureFixtures) {
    // For the HOME team, their opponent is the AWAY team
    if (!result[fixture.team_h]) result[fixture.team_h] = [];
    result[fixture.team_h].push({
      gw: fixture.event,
      opponent: teamsById[fixture.team_a]?.short_name || "???",
      opponent_full: teamsById[fixture.team_a]?.name || "Unknown",
      is_home: true,
      fdr: fixture.team_h_difficulty,
    });

    // For the AWAY team, their opponent is the HOME team
    if (!result[fixture.team_a]) result[fixture.team_a] = [];
    result[fixture.team_a].push({
      gw: fixture.event,
      opponent: teamsById[fixture.team_h]?.short_name || "???",
      opponent_full: teamsById[fixture.team_h]?.name || "Unknown",
      is_home: false,
      fdr: fixture.team_a_difficulty,
    });
  }

  // Sort each team's fixtures by gameweek number
  for (const teamId of Object.keys(result)) {
    result[teamId].sort((a, b) => a.gw - b.gw);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Find current gameweek
// ---------------------------------------------------------------------------

/**
 * Determine two gameweek numbers: currentGw and planningGw.
 *
 * The FPL API marks one event as `is_current` and one as `is_next`.
 * After a GW deadline passes but before its matches kick off, the API
 * flips `is_next` to the FOLLOWING gameweek. This causes a fixture
 * offset bug: the app would skip the current GW's matches entirely.
 *
 * We solve this by maintaining TWO GW values:
 *
 * currentGw -- the "live" GW. Stays on the active GW until all its
 *   matches finish. Used for: live points display, accuracy tracking,
 *   picks fetching, and the "GW in progress" label.
 *
 * planningGw -- the "forward-looking" GW. Jumps to the next GW as
 *   soon as the current GW's deadline has passed, regardless of whether
 *   matches have finished. Used for: upcoming fixtures (Next 5),
 *   Best XI title/recommendations, transfer recommendations, captaincy
 *   picks, projected points, and composite scores' fixture component.
 *   This lets managers plan ahead for next week while the current week
 *   is still being played.
 *
 * @param {Array} events - The `events` array from bootstrap-static
 * @param {Array} fixtures - The full fixtures array from the API
 * @returns {{ currentGw: number, planningGw: number }}
 */
export function findCurrentGameweek(events, fixtures = []) {
  const now = new Date();

  // --- currentGw: stays on the active GW until all matches finish ---
  const currentEvent = events.find((e) => e.is_current);
  let currentGw;

  if (currentEvent && fixtures.length) {
    const currentGwFixtures = fixtures.filter((f) => f.event === currentEvent.id);
    const hasUnfinished = currentGwFixtures.some((f) => !f.finished);
    // If any match in the current GW hasn't finished, stay on it
    if (hasUnfinished) {
      currentGw = currentEvent.id;
    }
  }

  // All current GW matches are done (or no current GW), move to next
  if (!currentGw) {
    const nextEvent = events.find((e) => e.is_next);
    if (nextEvent) {
      currentGw = nextEvent.id;
    } else if (currentEvent) {
      currentGw = currentEvent.id;
    } else {
      // Fallback: first unfinished gameweek
      const unfinished = events.find((e) => !e.finished);
      currentGw = unfinished ? unfinished.id : 1;
    }
  }

  // --- planningGw: jumps ahead once the deadline passes ---
  // If the current event's deadline has passed, planning should look
  // at the NEXT GW so upcoming fixtures, recommendations, and Best XI
  // all target the week managers can actually set their team for.
  let planningGw = currentGw;

  if (currentEvent) {
    const deadline = new Date(currentEvent.deadline_time);
    const deadlinePassed = now >= deadline;

    if (deadlinePassed) {
      // Deadline has passed -- plan for the next GW
      const nextEvent = events.find((e) => e.is_next);
      if (nextEvent) {
        planningGw = nextEvent.id;
      } else {
        // Current GW deadline passed but no "next" exists (end of season).
        // Try the event after the current one.
        const nextById = events.find((e) => e.id === currentEvent.id + 1);
        planningGw = nextById ? nextById.id : currentGw;
      }
    }
    // If deadline hasn't passed yet, planningGw stays equal to currentGw.
    // This is correct: you're still planning for the upcoming GW whose
    // deadline you haven't locked your team for yet.
  }

  return { currentGw, planningGw };
}

// ---------------------------------------------------------------------------
// Full transform pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full data transformation pipeline.
 * Takes raw API responses and produces normalised, enriched player data
 * ready for the scoring algorithm and UI.
 *
 * Returns both currentGw and planningGw:
 * - currentGw: for live points, accuracy tracking, picks fetching
 * - planningGw: for upcoming fixtures, Best XI, recommendations, projections
 *
 * Upcoming fixtures are built from planningGw so that forward-looking
 * features (Next 5, transfers, captaincy) show the next actionable
 * fixtures even while the current GW's matches are still being played.
 *
 * @param {Object} bootstrap - The bootstrap-static response
 * @param {Array} fixtures - The fixtures response
 * @returns {Object} - { players, teamsById, currentGw, planningGw, events, elementTypes, gameSettings }
 */
export function transformAll(bootstrap, fixtures) {
  const teamsById = buildTeamsById(bootstrap.teams);
  const { currentGw, planningGw } = findCurrentGameweek(bootstrap.events, fixtures);

  // Build upcoming fixtures from planningGw so forward-looking views
  // (Next 5, recommendations, Best XI) show the next actionable fixtures,
  // not the in-progress GW's fixtures which the manager can't act on.
  const upcomingFixtures = buildUpcomingFixtures(
    fixtures,
    teamsById,
    planningGw
  );

  const players = bootstrap.elements.map((rawPlayer) =>
    normalisePlayer(rawPlayer, teamsById, upcomingFixtures)
  );

  return {
    players,
    teamsById,
    currentGw,
    planningGw,
    events: bootstrap.events,
    elementTypes: bootstrap.element_types,
    gameSettings: bootstrap.game_settings,
  };
}
