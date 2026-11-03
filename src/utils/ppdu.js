/**
 * ppdu.js -- Points Per Difficulty Unit calculation
 *
 * PPDU = team's Premier League points / mean FDR of their completed fixtures.
 *
 * This metric adjusts a team's league standing by fixture difficulty.
 * A team with 15 points from hard fixtures (high average FDR) gets a
 * higher PPDU than one with 15 points from easy fixtures.
 *
 * Higher PPDU = better performance relative to difficulty faced.
 *
 * Data sources:
 * - Team PL points, W/D/L: derived from completed fixtures (match scores).
 *   We compute these ourselves rather than relying on bootstrap.teams[]
 *   fields (points, win, draw, loss) because those fields can be zero
 *   or stale early in the season, even when fixtures have finished.
 * - Completed fixture FDRs: from fixtures where finished === true,
 *   using team_h_difficulty / team_a_difficulty as the FDR for each
 *   team's perspective on that fixture.
 */

// ---------------------------------------------------------------------------
// Calculate PPDU for all teams
// ---------------------------------------------------------------------------

/**
 * Compute PPDU (Points Per Difficulty Unit) for every team.
 *
 * For each team, we:
 * 1. Find all completed fixtures involving that team
 * 2. Collect the FDR from that team's perspective (home or away difficulty)
 * 3. Derive W/D/L and PL points from match scores (team_h_score, team_a_score)
 * 4. Calculate mean FDR across completed fixtures
 * 5. Divide PL points by mean FDR to get PPDU
 *
 * Why derive W/D/L from fixtures instead of using bootstrap.teams[] fields?
 * The FPL API's teams array sometimes has points/win/draw/loss as 0 early
 * in the season even after matches have been played. By computing from
 * actual match scores in the fixtures array, we always get accurate data
 * as long as a fixture is marked finished and has scores populated.
 *
 * @param {Object} teamsById - Lookup map: team ID -> team object (from bootstrap.teams)
 * @param {Array} fixtures - Full fixtures array from the FPL API
 * @returns {Array} - Sorted array of team PPDU objects, highest PPDU first:
 *   [{ teamId, teamName, shortName, plPoints, played, wins, draws, losses,
 *      meanFdr, ppdu, completedFdrs }]
 */
export function calculatePPDU(teamsById, fixtures) {
  if (!teamsById || !fixtures?.length) return [];

  // ---------------------------------------------------------------------------
  // Pass 1: Walk completed fixtures, collecting FDRs and W/D/L for each team
  // ---------------------------------------------------------------------------

  // Per-team accumulators: fdrs[], wins, draws, losses
  const teamData = {}; // teamId -> { fdrs: [], wins: 0, draws: 0, losses: 0 }

  // Helper to ensure the accumulator exists for a given team
  const ensureTeam = (id) => {
    if (!teamData[id]) {
      teamData[id] = { fdrs: [], wins: 0, draws: 0, losses: 0 };
    }
  };

  // Only consider fixtures that are finished AND assigned to a gameweek.
  // Fixtures with event === null are unscheduled and should be skipped.
  const completedFixtures = fixtures.filter((f) => f.finished && f.event != null);

  for (const fixture of completedFixtures) {
    const homeId = fixture.team_h;
    const awayId = fixture.team_a;
    const homeScore = fixture.team_h_score;
    const awayScore = fixture.team_a_score;

    ensureTeam(homeId);
    ensureTeam(awayId);

    // Collect FDR from each team's perspective.
    // team_h_difficulty = how hard this fixture is for the HOME team.
    // team_a_difficulty = how hard this fixture is for the AWAY team.
    teamData[homeId].fdrs.push(fixture.team_h_difficulty);
    teamData[awayId].fdrs.push(fixture.team_a_difficulty);

    // Derive W/D/L from actual match scores.
    // If scores are null (shouldn't happen for finished fixtures but guard
    // against it), we skip the W/D/L tally for this fixture.
    if (homeScore != null && awayScore != null) {
      if (homeScore > awayScore) {
        // Home win
        teamData[homeId].wins += 1;
        teamData[awayId].losses += 1;
      } else if (homeScore < awayScore) {
        // Away win
        teamData[awayId].wins += 1;
        teamData[homeId].losses += 1;
      } else {
        // Draw
        teamData[homeId].draws += 1;
        teamData[awayId].draws += 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 2: Build PPDU results from accumulated data
  // ---------------------------------------------------------------------------

  const results = [];

  for (const teamId of Object.keys(teamsById)) {
    const team = teamsById[teamId];
    const data = teamData[teamId];

    // Skip teams with no completed fixtures (e.g. very start of season)
    if (!data || data.fdrs.length === 0) continue;

    // Mean FDR across all completed fixtures
    const totalFdr = data.fdrs.reduce((sum, fdr) => sum + fdr, 0);
    const meanFdr = totalFdr / data.fdrs.length;

    // PL points: 3 per win + 1 per draw (standard football points system)
    const plPoints = (data.wins * 3) + data.draws;

    // PPDU = PL points / mean FDR
    // Guard against division by zero (shouldn't happen since FDR >= 1)
    const ppdu = meanFdr > 0 ? plPoints / meanFdr : 0;

    results.push({
      teamId: Number(teamId),
      teamName: team.name || "Unknown",
      shortName: team.short_name || "???",
      plPoints,
      played: data.fdrs.length,
      wins: data.wins,
      draws: data.draws,
      losses: data.losses,
      meanFdr: Math.round(meanFdr * 100) / 100,
      ppdu: Math.round(ppdu * 100) / 100,
      completedFdrs: data.fdrs,
    });
  }

  // Sort by PPDU descending (best adjusted performance first)
  results.sort((a, b) => b.ppdu - a.ppdu);

  return results;
}
