/**
 * fdrCalc.js -- Fixture Difficulty Rating calculator
 *
 * The FPL API provides difficulty ratings (1-5) for each fixture,
 * where 1 = very easy and 5 = very hard. This module takes those
 * ratings and turns them into a score we can use in the composite
 * scoring algorithm.
 *
 * Key insight: for the composite score, we INVERT the difficulty.
 * A player with easy fixtures (low FDR) should get a HIGH score,
 * because easy fixtures are good for points.
 */

// ---------------------------------------------------------------------------
// Colour mapping for FDR display
// ---------------------------------------------------------------------------

/**
 * Map a fixture difficulty rating to a background colour.
 * Used in the Fixture Grid and fixture mini-rows throughout the app.
 *
 * 1 = very easy (bright green)
 * 2 = easy (green)
 * 3 = medium (yellow/amber)
 * 4 = hard (orange/red)
 * 5 = very hard (dark red)
 */
export const FDR_COLORS = {
  1: { bg: "#375523", text: "#ffffff" },  // Dark green
  2: { bg: "#01fc7a", text: "#000000" },  // Bright green
  3: { bg: "#e7e7e7", text: "#000000" },  // Light grey
  4: { bg: "#ff1751", text: "#ffffff" },  // Red
  5: { bg: "#80072d", text: "#ffffff" },  // Dark red
};

/**
 * Get the colour scheme for a given FDR value.
 * Falls back to a neutral grey if the value is unexpected.
 *
 * @param {number} fdr - Fixture difficulty rating (1-5)
 * @returns {Object} - { bg, text } colour values
 */
export function getFdrColor(fdr) {
  return FDR_COLORS[fdr] || { bg: "#555555", text: "#ffffff" };
}

// ---------------------------------------------------------------------------
// FDR scoring for composite algorithm
// ---------------------------------------------------------------------------

/**
 * Calculate the fixture difficulty score for a player.
 *
 * Takes the player's upcoming fixture difficulties (next 5 GWs),
 * averages them, then inverts so that easy fixtures = high score.
 *
 * Formula:
 *   avg_fdr = sum(next 5 FDR values) / 5
 *   score = ((5 - avg_fdr) / 4) * 100
 *
 * Examples:
 *   All FDR 1 (easiest possible): ((5-1)/4)*100 = 100
 *   All FDR 3 (average): ((5-3)/4)*100 = 50
 *   All FDR 5 (hardest possible): ((5-5)/4)*100 = 0
 *
 * @param {number[]} fdrValues - Array of FDR ratings for upcoming fixtures
 * @param {number} count - How many fixtures to consider (default 5)
 * @returns {number} - Score from 0 (hardest fixtures) to 100 (easiest fixtures)
 */
export function calcFixtureScore(fdrValues, count = 5) {
  if (!fdrValues || fdrValues.length === 0) return 50; // neutral default

  // Take only the first `count` fixtures
  const subset = fdrValues.slice(0, count);

  // Average the FDR values
  const avgFdr = subset.reduce((sum, val) => sum + val, 0) / subset.length;

  // Invert: low FDR (easy) = high score
  // FDR ranges from 1-5, so (5 - avgFdr) ranges from 0-4
  // Divide by 4 and multiply by 100 to get 0-100 scale
  const score = ((5 - avgFdr) / 4) * 100;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Build full FDR grid for the Fixtures page
// ---------------------------------------------------------------------------

/**
 * Build the fixture difficulty grid data for all 20 teams.
 * Produces one row per team, with columns for each upcoming gameweek.
 *
 * @param {Array} fixtures - Full fixtures array from the API
 * @param {Object} teamsById - Team lookup map
 * @param {number} startGw - First gameweek to show (e.g., 6)
 * @param {number} count - How many gameweeks to show (default 6)
 * @returns {Array} - Array of { teamId, teamName, shortName, fixtures: [...] }
 */
export function buildFdrGrid(fixtures, teamsById, startGw, count = 6) {
  const teamIds = Object.keys(teamsById).map(Number);
  const grid = [];

  for (const teamId of teamIds) {
    const team = teamsById[teamId];
    const teamRow = {
      teamId,
      teamName: team.name,
      shortName: team.short_name,
      // We'll fill this with one entry per GW in our range
      fixtures: [],
    };

    // For each gameweek in our range, find this team's fixture
    for (let gw = startGw; gw < startGw + count; gw++) {
      const fixture = fixtures.find(
        (f) =>
          f.event === gw && (f.team_h === teamId || f.team_a === teamId)
      );

      if (fixture) {
        const isHome = fixture.team_h === teamId;
        const opponentId = isHome ? fixture.team_a : fixture.team_h;
        const opponent = teamsById[opponentId];

        teamRow.fixtures.push({
          gw,
          opponent: opponent?.short_name || "???",
          is_home: isHome,
          fdr: isHome ? fixture.team_h_difficulty : fixture.team_a_difficulty,
        });
      } else {
        // No fixture found for this GW (could be a blank GW)
        teamRow.fixtures.push({
          gw,
          opponent: "-",
          is_home: null,
          fdr: 3, // neutral
        });
      }
    }

    grid.push(teamRow);
  }

  // Sort alphabetically by team name
  grid.sort((a, b) => a.teamName.localeCompare(b.teamName));

  return grid;
}

/**
 * Calculate the total FDR sum for a team row.
 * Used to sort teams by "easiest upcoming run".
 * Lower total = easier fixtures.
 *
 * @param {Object} teamRow - A single row from buildFdrGrid()
 * @returns {number} - Sum of all FDR values in the row
 */
export function sumFdr(teamRow) {
  return teamRow.fixtures.reduce((sum, f) => sum + f.fdr, 0);
}
