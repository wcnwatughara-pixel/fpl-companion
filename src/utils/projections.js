/**
 * projections.js -- Projected FPL points calculator
 *
 * Estimates how many ACTUAL FPL points a player will score over
 * the next N gameweeks. This is a separate metric from composite score:
 *
 *   Composite score  = "How good a pick is this player?" (0-100 relative rank)
 *   Projected points = "How many points will they likely score?" (absolute estimate)
 *
 * The projection blends two baselines (points per game and points per 90),
 * adjusts for fixture difficulty over the horizon, scales by availability
 * (chance of playing), and accounts for minutes share (nailedness).
 *
 * The formula, step by step:
 *
 *   1. BASE RATE: weighted blend of ppg and pts_per_90
 *      - ppg reflects actual FPL scoring (bonus, clean sheets, etc.)
 *      - pts_per_90 removes substitution noise
 *      - Blend: 60% ppg + 40% pts_per_90 (ppg dominates because it
 *        includes FPL-specific bonus points that per-90 misses)
 *      - Early season (< 5 GWs played): lean more on ppg since per-90
 *        is noisy with small samples
 *
 *   2. FIXTURE MULTIPLIER: adjust the base rate by upcoming difficulty
 *      - Average the FDR values for the next N fixtures
 *      - Convert to a multiplier: easy fixtures (FDR 1-2) boost output,
 *        hard fixtures (FDR 4-5) reduce it
 *      - Formula: 1 + (3 - avgFDR) * 0.12
 *        FDR 1 -> 1.24 (24% boost), FDR 3 -> 1.0 (neutral),
 *        FDR 5 -> 0.76 (24% reduction)
 *      - The 0.12 coefficient is conservative -- fixtures matter but
 *        aren't everything. A great player still scores against tough teams.
 *
 *   3. AVAILABILITY ADJUSTMENT: scale by probability of actually playing
 *      - Multiply by (chance_of_playing / 100)
 *      - A 75% chance player gets 75% of their projected output
 *      - This is LINEAR (unlike composite's quadratic penalty) because
 *        we're estimating expected points, not ranking attractiveness
 *
 *   4. NAILEDNESS FACTOR: account for rotation / bench risk
 *      - Players who play every minute: factor = 1.0
 *      - Players who play ~60% of minutes: factor = 0.85
 *      - Players who barely play: factor drops toward 0.5
 *      - Formula: 0.5 + (minutesFraction * 0.5), capped at 1.0
 *      - This prevents projecting full points for a player who only
 *        gets 10-minute cameos
 *
 *   5. FINAL PROJECTION:
 *      projectedPoints = baseRate * fixtureMultiplier * availability
 *                        * nailednessFactor * horizonGames
 *
 * @module projections
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How much weight to give ppg vs pts_per_90 in the base rate blend.
 * ppg gets more weight because it captures FPL-specific scoring
 * (bonus points, clean sheet points) that per-90 raw stats miss.
 */
const PPG_WEIGHT = 0.6;
const PTS_PER_90_WEIGHT = 0.4;

/**
 * How much fixture difficulty adjusts the base rate.
 * 0.12 means FDR 1 gives a 24% boost and FDR 5 gives a 24% penalty.
 * Keep this moderate -- player quality matters more than fixtures.
 */
const FDR_SENSITIVITY = 0.12;

/**
 * Minimum games played before we trust per-90 data.
 * Below this, we rely entirely on ppg.
 */
const MIN_MINUTES_FOR_PER90 = 180; // ~2 full games

// ---------------------------------------------------------------------------
// Core projection function
// ---------------------------------------------------------------------------

/**
 * Calculate projected FPL points for a single player over N gameweeks.
 *
 * @param {Object} player - Normalised player object (from transforms.js)
 *   Required fields: ppg, pts_per_90, minutes, upcoming_fdr,
 *   chance_of_playing
 * @param {number} horizon - Number of future gameweeks to project over
 * @param {number} completedGws - Number of finished gameweeks this season
 * @returns {Object} - {
 *   projected: number (total projected points over horizon),
 *   perGame: number (projected points per game),
 *   breakdown: {
 *     baseRate: number,
 *     fixtureMultiplier: number,
 *     availability: number,
 *     nailednessFactor: number
 *   }
 * }
 */
export function projectPlayerPoints(player, horizon, completedGws) {
  // ------- Step 1: Base rate -------
  // Blend ppg and pts_per_90, with a fallback when per-90 data is thin
  const ppg = player.ppg || 0;
  const ptsPer90 = player.pts_per_90 || 0;
  const minutes = player.minutes || 0;

  let baseRate;
  if (minutes < MIN_MINUTES_FOR_PER90) {
    // Not enough minutes for reliable per-90 data -- lean on ppg entirely.
    // If ppg is also 0 (new signing, not yet played), base rate is 0.
    baseRate = ppg;
  } else {
    // Blend ppg and pts_per_90
    baseRate = ppg * PPG_WEIGHT + ptsPer90 * PTS_PER_90_WEIGHT;
  }

  // ------- Step 2: Fixture multiplier -------
  // Average the FDR values for the next N fixtures (or however many exist)
  const fdrValues = player.upcoming_fdr || [];
  const horizonFdr = fdrValues.slice(0, horizon);
  let fixtureMultiplier = 1.0;

  if (horizonFdr.length > 0) {
    const avgFdr = horizonFdr.reduce((sum, v) => sum + v, 0) / horizonFdr.length;
    // FDR 3 is neutral (multiplier = 1.0)
    // FDR 1 -> 1 + (3-1)*0.12 = 1.24
    // FDR 5 -> 1 + (3-5)*0.12 = 0.76
    fixtureMultiplier = 1 + (3 - avgFdr) * FDR_SENSITIVITY;
  }

  // ------- Step 3: Availability -------
  // Linear scaling by chance of playing (0 to 1)
  const chanceOfPlaying = player.chance_of_playing ?? 100;
  const availability = chanceOfPlaying / 100;

  // ------- Step 4: Nailedness factor -------
  // How much of available minutes does this player actually get?
  // A player who plays every minute of every GW has fraction = 1.0
  let nailednessFactor = 1.0;
  if (completedGws > 0) {
    const maxPossibleMinutes = completedGws * 90;
    const minutesFraction = Math.min(1, minutes / maxPossibleMinutes);
    // Scale from 0.5 (barely plays) to 1.0 (every minute)
    // This means even a player with 0 minutes gets 0.5 * base,
    // which is generous, but new signings might start playing
    nailednessFactor = 0.5 + minutesFraction * 0.5;
  }

  // ------- Step 5: Final projection -------
  // Number of games in the horizon (use actual fixture count if fewer
  // fixtures remain than the requested horizon)
  const horizonGames = Math.max(1, Math.min(horizon, horizonFdr.length || horizon));

  const projected = baseRate * fixtureMultiplier * availability
                    * nailednessFactor * horizonGames;

  // Guard against NaN from any unexpected upstream issue
  const safeProjected = isNaN(projected) ? 0 : Math.round(projected * 10) / 10;
  const safePerGame = horizonGames > 0
    ? Math.round((safeProjected / horizonGames) * 10) / 10
    : 0;

  return {
    projected: safeProjected,
    perGame: safePerGame,
    breakdown: {
      baseRate:           Math.round(baseRate * 100) / 100,
      fixtureMultiplier:  Math.round(fixtureMultiplier * 1000) / 1000,
      availability:       Math.round(availability * 100) / 100,
      nailednessFactor:   Math.round(nailednessFactor * 1000) / 1000,
    },
  };
}

// ---------------------------------------------------------------------------
// Batch projection for all players
// ---------------------------------------------------------------------------

/**
 * Calculate projected points for every player in the dataset.
 *
 * Attaches projectedPoints, projectedPerGame, and projectionBreakdown
 * to each player object. Does NOT re-sort the array -- the caller
 * can sort by whatever metric they want (composite, projected, price, etc.).
 *
 * @param {Array} players - Array of normalised player objects
 * @param {number} horizon - Number of future gameweeks to project over
 * @param {number} completedGws - Number of finished gameweeks this season
 * @returns {Array} - Same players with projection fields attached
 */
export function calculateProjectedPoints(players, horizon, completedGws) {
  return players.map((player) => {
    const projection = projectPlayerPoints(player, horizon, completedGws);
    return {
      ...player,
      projectedPoints:     projection.projected,
      projectedPerGame:    projection.perGame,
      projectionBreakdown: projection.breakdown,
    };
  });
}
