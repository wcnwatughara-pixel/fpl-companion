/**
 * fixturePairings.js -- Fixture Alternating Pairing Algorithm
 *
 * Finds pairs of teams whose fixture schedules alternate: when one team
 * has hard games, the other has easy ones, and vice versa. Owning players
 * from both teams means you always have at least one asset on a green run.
 *
 * How it works:
 * 1. For each team, build a vector of upcoming FDRs over the chosen horizon
 * 2. For every pair of teams, calculate an "alternation score" that measures
 *    how well their FDR schedules complement each other
 * 3. Rank pairs by alternation score (higher = better alternation)
 *
 * The alternation score uses inverse correlation: if Team A's FDR goes up
 * when Team B's goes down (and vice versa), they have strong alternation.
 * We also factor in the "best available FDR" each week -- the lower of
 * the two teams' FDRs -- since the whole point is that you start whichever
 * player has the easier fixture.
 *
 * A perfect pair would have alternation score near 100: every week, one
 * team has FDR 1-2 while the other has FDR 4-5. In practice, scores above
 * 60 indicate genuinely useful alternation.
 */

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/**
 * Find the best fixture-alternating team pairs.
 *
 * @param {Object} upcomingByTeam - { teamId: [{ gw, fdr, opponent, is_home }] }
 *   from buildUpcomingFixtures()
 * @param {Object} teamsById - { teamId: teamObject } lookup
 * @param {Array} gwRange - Array of GW numbers to analyze, e.g. [7, 8, 9, 10, 11]
 * @returns {Array} - Sorted array (best pairs first) of:
 *   {
 *     teamA: { id, name, shortName },
 *     teamB: { id, name, shortName },
 *     alternationScore: number (0-100, higher = better alternation),
 *     weekByWeek: [{ gw, fdrA, fdrB, pick, bestFdr }],
 *     avgBestFdr: number (average FDR when always picking the easier fixture),
 *     worstWeekFdr: number (highest "best FDR" across all weeks -- the pair's weak spot),
 *   }
 */
export function findBestPairings(upcomingByTeam, teamsById, gwRange) {
  if (!upcomingByTeam || !teamsById || !gwRange?.length) return [];

  const teamIds = Object.keys(teamsById).map(Number);

  // ---------------------------------------------------------------------------
  // Step 1: Build FDR vectors for each team over the requested GW range.
  // Each team gets an array of FDR values aligned to gwRange.
  // If a team has no fixture in a GW (blank GW), use 3.0 (neutral).
  // If a team has two fixtures in a GW (double GW), use the average.
  // ---------------------------------------------------------------------------

  const fdrVectors = {};
  // Parallel opponent info vector: stores short opponent label per GW
  // e.g. "ARS (H)" or "LIV (A)", or "BGW" for blank, "2x" for double
  const oppVectors = {};

  for (const teamId of teamIds) {
    const teamFixtures = upcomingByTeam[teamId] || [];
    const fdrVec = [];
    const oppVec = [];

    for (const gw of gwRange) {
      const gwFixes = teamFixtures.filter((f) => f.gw === gw);
      if (gwFixes.length === 0) {
        // Blank GW: neutral FDR since neither easy nor hard
        fdrVec.push(3.0);
        oppVec.push("BGW");
      } else if (gwFixes.length === 1) {
        fdrVec.push(gwFixes[0].fdr);
        const fix = gwFixes[0];
        // Build "OPP (H/A)" label from the fixture's opponent field
        const oppName = fix.opponent || "???";
        const venue = fix.is_home ? "(H)" : "(A)";
        oppVec.push(`${oppName} ${venue}`);
      } else {
        // Double GW: average the FDRs (both games matter)
        const avg = gwFixes.reduce((s, f) => s + f.fdr, 0) / gwFixes.length;
        fdrVec.push(avg);
        oppVec.push(`${gwFixes.length}x`);
      }
    }

    fdrVectors[teamId] = fdrVec;
    oppVectors[teamId] = oppVec;
  }

  // ---------------------------------------------------------------------------
  // Step 2: Score every pair of teams by alternation quality.
  //
  // The alternation score combines two signals:
  //
  // a) Inverse correlation of FDR vectors.
  //    Pearson correlation measures how two sequences move together.
  //    We want them to move OPPOSITE to each other (negative correlation).
  //    A correlation of -1.0 is perfect alternation; +1.0 is identical schedules.
  //    We map [-1, +1] to [100, 0] so higher = better alternation.
  //
  // b) Average "best available FDR" when always picking the easier fixture.
  //    A pair where you always have FDR 1-2 available is better than one
  //    where you always have FDR 3 available, even if alternation is equal.
  //    We map this from [1, 5] to [100, 0].
  //
  // Final score = 60% correlation component + 40% best-FDR component.
  // This weights the alternation pattern (does it actually alternate?)
  // more than the absolute difficulty (are the easy weeks really easy?),
  // but both matter.
  // ---------------------------------------------------------------------------

  const pairs = [];

  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const idA = teamIds[i];
      const idB = teamIds[j];
      const vecA = fdrVectors[idA];
      const vecB = fdrVectors[idB];

      if (!vecA || !vecB) continue;

      // Build week-by-week breakdown: which team would you start each GW?
      const oppA = oppVectors[idA] || [];
      const oppB = oppVectors[idB] || [];
      const weekByWeek = gwRange.map((gw, idx) => {
        const fdrA = vecA[idx];
        const fdrB = vecB[idx];
        // Pick the team with the lower (easier) FDR
        const bestFdr = Math.min(fdrA, fdrB);
        const pick = fdrA <= fdrB ? "A" : "B";
        return { gw, fdrA, fdrB, oppA: oppA[idx] || "", oppB: oppB[idx] || "", pick, bestFdr };
      });

      // Average best-available FDR across all weeks
      const avgBestFdr = weekByWeek.reduce((s, w) => s + w.bestFdr, 0) / weekByWeek.length;

      // Worst week: the highest "best FDR" in the pair (both teams have hard fixtures)
      const worstWeekFdr = Math.max(...weekByWeek.map((w) => w.bestFdr));

      // Pearson correlation between the two FDR vectors
      const correlation = pearsonCorrelation(vecA, vecB);

      // Map correlation [-1, +1] to [0, 100] where -1 -> 100 (perfect alternation)
      const correlationScore = ((1 - correlation) / 2) * 100;

      // Map average best FDR [1, 5] to [0, 100] where 1 -> 100 (always easy)
      const bestFdrScore = ((5 - avgBestFdr) / 4) * 100;

      // Combined alternation score: 60% pattern quality, 40% fixture ease
      const alternationScore = Math.round(
        (correlationScore * 0.6 + bestFdrScore * 0.4) * 10
      ) / 10;

      const teamA = teamsById[idA];
      const teamB = teamsById[idB];

      pairs.push({
        teamA: { id: idA, name: teamA?.name || "Unknown", shortName: teamA?.short_name || "???" },
        teamB: { id: idB, name: teamB?.name || "Unknown", shortName: teamB?.short_name || "???" },
        alternationScore,
        weekByWeek,
        avgBestFdr: Math.round(avgBestFdr * 100) / 100,
        worstWeekFdr,
        correlation: Math.round(correlation * 1000) / 1000,
      });
    }
  }

  // Sort by alternation score descending (best pairs first)
  pairs.sort((a, b) => b.alternationScore - a.alternationScore);

  return pairs;
}

// ---------------------------------------------------------------------------
// Player-level pairings
// ---------------------------------------------------------------------------

/**
 * Find the best player pairs for fixture alternation within a position.
 *
 * Takes the top team pairings and recommends specific players from each
 * team in the pair, filtered by position and ranked by a chosen metric.
 *
 * @param {Array} teamPairings - Output of findBestPairings()
 * @param {Array} players - Full player array with scores
 * @param {string} position - Position filter: "GKP", "DEF", "MID", "FWD"
 * @param {string} sortKey - Player metric to rank by: "compositeScore",
 *   "projectedPoints", "blendedScore"
 * @param {number} [maxResults=10] - How many player pairs to return
 * @returns {Array} - Array of player pair objects:
 *   {
 *     teamPairing: (the team-level pairing object),
 *     playerA: (best player from teamA at this position),
 *     playerB: (best player from teamB at this position),
 *     combinedScore: playerA[sortKey] + playerB[sortKey],
 *     combinedPrice: playerA.price + playerB.price,
 *   }
 */
export function findPlayerPairings(teamPairings, players, position, sortKey = "blendedScore", maxResults = 10) {
  if (!teamPairings?.length || !players?.length || !position) return [];

  // Pre-filter players to only those in the requested position with
  // meaningful minutes (45+), so we don't suggest benchwarmer
  const positionPlayers = players.filter(
    (p) => p.position_name === position && (p.minutes || 0) >= 45
  );

  // Build a lookup: teamId -> best player at this position (by sortKey)
  // We take the top player from each team to keep suggestions focused
  const bestByTeam = {};
  for (const p of positionPlayers) {
    const existing = bestByTeam[p.team];
    if (!existing || (p[sortKey] || 0) > (existing[sortKey] || 0)) {
      bestByTeam[p.team] = p;
    }
  }

  const results = [];

  // Walk through team pairings (already sorted by alternation quality)
  // and attach the best player from each team
  for (const pairing of teamPairings) {
    const playerA = bestByTeam[pairing.teamA.id];
    const playerB = bestByTeam[pairing.teamB.id];

    // Both teams must have a viable player at this position
    if (!playerA || !playerB) continue;

    results.push({
      teamPairing: pairing,
      playerA,
      playerB,
      combinedScore: Math.round(
        ((playerA[sortKey] || 0) + (playerB[sortKey] || 0)) * 10
      ) / 10,
      combinedPrice: Math.round((playerA.price + playerB.price) * 10) / 10,
      alternationScore: pairing.alternationScore,
    });

    if (results.length >= maxResults) break;
  }

  // Sort by combined score (best total value from both players)
  // within the already-filtered-by-alternation set
  results.sort((a, b) => b.combinedScore - a.combinedScore);

  return results;
}

// ---------------------------------------------------------------------------
// Multi-position pairings
// ---------------------------------------------------------------------------

/**
 * Find player pairs across two different positions on alternating teams.
 *
 * Unlike findPlayerPairings (which finds two players of the SAME position),
 * this picks one player from each of the two positions -- e.g. the best MID
 * from team A and the best FWD from team B -- so you rotate between a
 * midfielder and a forward depending on whose team has the easier fixture.
 *
 * For each team pairing we test both assignments (posA on teamA + posB on
 * teamB, and posB on teamA + posA on teamB) and keep whichever scores higher.
 *
 * @param {Array} teamPairings - Output of findBestPairings()
 * @param {Array} players - Full player array with scores
 * @param {Array} positions - Exactly 2 position strings, e.g. ["MID", "FWD"]
 * @param {string} sortKey - Player metric to rank by
 * @param {number} [maxResults=10]
 * @returns {Array} - Same shape as findPlayerPairings, with added
 *   positionA / positionB fields showing which position each player fills
 */
export function findMultiPositionPairings(teamPairings, players, positions, sortKey = "blendedScore", maxResults = 10) {
  if (!teamPairings?.length || !players?.length || positions?.length !== 2) return [];

  const [pos1, pos2] = positions;

  // Build per-team, per-position lookup: teamId -> { pos: bestPlayer }
  // Only players with 45+ minutes to filter out bench warmers
  const bestByTeamPos = {};

  for (const p of players) {
    if ((p.minutes || 0) < 45) continue;
    if (p.position_name !== pos1 && p.position_name !== pos2) continue;

    const key = `${p.team}_${p.position_name}`;
    const existing = bestByTeamPos[key];
    if (!existing || (p[sortKey] || 0) > (existing[sortKey] || 0)) {
      bestByTeamPos[key] = p;
    }
  }

  const results = [];

  for (const pairing of teamPairings) {
    const aId = pairing.teamA.id;
    const bId = pairing.teamB.id;

    // Option 1: pos1 from teamA, pos2 from teamB
    const opt1A = bestByTeamPos[`${aId}_${pos1}`];
    const opt1B = bestByTeamPos[`${bId}_${pos2}`];
    const score1 = (opt1A && opt1B)
      ? (opt1A[sortKey] || 0) + (opt1B[sortKey] || 0)
      : -1;

    // Option 2: pos2 from teamA, pos1 from teamB
    const opt2A = bestByTeamPos[`${aId}_${pos2}`];
    const opt2B = bestByTeamPos[`${bId}_${pos1}`];
    const score2 = (opt2A && opt2B)
      ? (opt2A[sortKey] || 0) + (opt2B[sortKey] || 0)
      : -1;

    // Skip if neither option has both players
    if (score1 < 0 && score2 < 0) continue;

    // Pick the higher-scoring assignment
    const [playerA, playerB, posA, posB] = score1 >= score2
      ? [opt1A, opt1B, pos1, pos2]
      : [opt2A, opt2B, pos2, pos1];

    results.push({
      teamPairing: pairing,
      playerA,
      playerB,
      positionA: posA,
      positionB: posB,
      combinedScore: Math.round(
        ((playerA[sortKey] || 0) + (playerB[sortKey] || 0)) * 10
      ) / 10,
      combinedPrice: Math.round((playerA.price + playerB.price) * 10) / 10,
      alternationScore: pairing.alternationScore,
    });

    if (results.length >= maxResults) break;
  }

  results.sort((a, b) => b.combinedScore - a.combinedScore);
  return results;
}

// ---------------------------------------------------------------------------
// Pearson correlation helper
// ---------------------------------------------------------------------------

/**
 * Calculate Pearson correlation coefficient between two numeric arrays.
 *
 * Returns a value from -1 (perfect inverse) to +1 (perfect correlation).
 * 0 = no correlation. For fixture pairing, we want negative values
 * (when one goes up, the other goes down).
 *
 * @param {Array} xs - First numeric array
 * @param {Array} ys - Second numeric array (same length)
 * @returns {number} - Correlation coefficient, or 0 if calculation fails
 */
function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }

  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  // If either vector has zero variance (all same values), correlation
  // is undefined. Return 0 (no alternation signal) rather than NaN.
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}
