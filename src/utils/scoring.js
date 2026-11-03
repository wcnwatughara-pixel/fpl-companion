/**
 * scoring.js -- Composite scoring algorithm
 *
 * This is the brain of the recommendation engine. It takes each player's
 * stats and fixtures and produces a single composite score from 0-100
 * that represents how good a pick they are right now.
 *
 * How it works:
 * 1. Group players by position (GKP, DEF, MID, FWD)
 * 2. For each group, normalise each metric to a 0-100 scale using
 *    min-max normalisation (best in group = 100, worst = 0)
 * 3. Apply early-season confidence discounts (form is noisy early on,
 *    fixtures are reliable regardless of when in the season)
 * 4. Combine the normalised metrics using weighted average
 * 5. Apply injury penalty based on chance_of_playing_next_round
 * 6. Apply opportunity bonus for players whose positional rivals are injured
 *
 * Weights for attackers (MID/FWD):
 *   Fixture difficulty: 25%    Points per 90: 18%
 *   ICT index:         12%    xGI per 90:    15%
 *   Minutes played:    10%    Form:          10%
 *   Injury penalty + opportunity bonus applied as multipliers after
 *
 * Weights for defenders (DEF/GKP) -- includes xGC (defensive solidity):
 *   Fixture difficulty: 25%    Points per 90: 15%
 *   ICT index:         10%    xGI per 90:    10%
 *   xGC per 90:        12%    Minutes played: 10%
 *   Form:               8%
 *   (xGC is inverted: lower conceded = higher score)
 */

import { calcFixtureScore } from "./fdrCalc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Weights for attacking positions (MID, FWD).
 * No xGC component -- attackers are judged on attacking output.
 * Must sum to 1.0 (before injury/opportunity adjustments).
 */
const WEIGHTS_ATTACK = {
  fixtureDifficulty: 0.28,
  pointsPer90:       0.20,
  ictIndex:          0.12,
  xgiPer90:          0.18,
  minutesPlayed:     0.12,
  form:              0.10,
  xgcPer90:          0.00, // Not used for attackers
  // Sums to 1.0. Injury/opportunity are post-hoc multipliers, not weights.
};

/**
 * Weights for defensive positions (GKP, DEF).
 * Includes xGC per 90 (inverted -- lower conceded = higher score).
 * This rewards defenders on teams with strong defensive records.
 * Must sum to 1.0 (before injury/opportunity adjustments).
 */
const WEIGHTS_DEFENCE = {
  fixtureDifficulty: 0.25,
  pointsPer90:       0.17,
  ictIndex:          0.10,
  xgiPer90:          0.10,
  xgcPer90:          0.15, // Defensive solidity (inverted: low xGC = high score)
  minutesPlayed:     0.12,
  form:              0.11,
  // Sums to 1.0. Injury/opportunity are post-hoc multipliers, not weights.
};

/**
 * Early-season confidence discounts.
 * In the first few gameweeks, stats are noisy because the sample size
 * is small. We discount volatile metrics and lean more on fixtures
 * (which are known in advance and therefore 100% reliable).
 *
 * A discount of 0.6 means we only trust that metric at 60% of its
 * normalised value. The "missing" weight effectively shifts toward
 * the undiscounted metrics (mainly fixtures).
 */
const EARLY_SEASON_DISCOUNTS = {
  fixtureDifficulty: 1.0, // Fixtures are known -- no discount
  pointsPer90:       0.7, // Small sample makes this noisy
  ictIndex:          0.8, // Slightly more stable than raw points
  xgiPer90:          0.8, // Model-based, somewhat stable
  xgcPer90:          0.8, // Same reasoning as xGI
  minutesPlayed:     0.9, // Fairly reliable even with few games
  form:              0.6, // Most volatile early on
};

/**
 * After this many completed gameweeks, stop applying discounts.
 * By GW10, there's enough data for all metrics to be meaningful.
 */
const EARLY_SEASON_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Min-max normalisation: scale a value to 0-100 within a group.
 * The player with the highest value in the group gets 100.
 * The player with the lowest gets 0.
 *
 * If min === max (everyone has the same value), return 50 (neutral).
 *
 * @param {number} value - The raw value to normalise
 * @param {number} min - The minimum value in the group
 * @param {number} max - The maximum value in the group
 * @returns {number} - Normalised value from 0 to 100
 */
function minMaxNorm(value, min, max) {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

/**
 * INVERTED min-max normalisation: lower values score higher.
 * Used for xGC per 90 where conceding fewer goals is better.
 *
 * @param {number} value - The raw value to normalise (lower = better)
 * @param {number} min - The minimum value in the group (best)
 * @param {number} max - The maximum value in the group (worst)
 * @returns {number} - Normalised value from 0 to 100 (100 = fewest conceded)
 */
function invertedMinMaxNorm(value, min, max) {
  if (max === min) return 50;
  return ((max - value) / (max - min)) * 100;
}

// ---------------------------------------------------------------------------
// Nailedness (minutes played) scoring
// ---------------------------------------------------------------------------

/**
 * Calculate how "nailed on" a player is based on minutes played.
 * A player who has played every minute of every finished GW scores 100.
 *
 * @param {number} minutes - Total minutes played this season
 * @param {number} finishedGws - Number of completed gameweeks
 * @returns {number} - Nailedness score from 0 to 100
 */
function calcNailedness(minutes, finishedGws) {
  if (finishedGws <= 0) return 50; // Can't calculate before season starts
  const maxPossible = finishedGws * 90;
  return Math.min(100, (minutes / maxPossible) * 100);
}

// ---------------------------------------------------------------------------
// Injury penalty
// ---------------------------------------------------------------------------

/**
 * Calculate an injury penalty multiplier based on chance_of_playing.
 *
 * - 100% (fully fit): multiplier = 1.0 (no penalty)
 * - 75% (probable):   multiplier = 0.85
 * - 50% (doubtful):   multiplier = 0.60
 * - 25% (unlikely):   multiplier = 0.30
 * - 0% (ruled out):   multiplier = 0.05 (near-zero, not fully zero
 *                      so they still appear in lists for reference)
 *
 * The curve is steeper than linear because a 50% chance player is
 * much worse than "half as good" -- you might get 0 points from them.
 *
 * @param {number} chanceOfPlaying - 0 to 100
 * @returns {number} - Multiplier from 0.05 to 1.0
 */
function calcInjuryPenalty(chanceOfPlaying) {
  if (chanceOfPlaying >= 100) return 1.0;
  if (chanceOfPlaying <= 0) return 0.05;
  // Quadratic curve: penalises doubt more than linearly
  // e.g. 75% -> (0.75)^1.5 = 0.65, then scaled to 0.05-1.0 range
  const fraction = chanceOfPlaying / 100;
  const curved = Math.pow(fraction, 1.5);
  return 0.05 + curved * 0.95;
}

// ---------------------------------------------------------------------------
// Opportunity bonus
// ---------------------------------------------------------------------------

/**
 * Detect players who might benefit from a teammate's injury.
 * If a player has low minutes but is "available" (status = "a") and
 * another player on the same team in the same position is injured,
 * this player may be about to start regularly.
 *
 * Returns a bonus multiplier (1.0 = no bonus, up to 1.25 = 25% boost).
 *
 * @param {Object} player - The player to check
 * @param {Array} allPlayers - All players in the dataset
 * @param {number} finishedGws - Completed gameweeks
 * @returns {number} - Multiplier from 1.0 to 1.25
 */
function calcOpportunityBonus(player, allPlayers, finishedGws) {
  // Only applies to available players with relatively low minutes
  if (player.status !== "a") return 1.0;

  const nailedness = calcNailedness(player.minutes, finishedGws);
  // Only give bonus to players who aren't already regular starters
  if (nailedness > 60) return 1.0;

  // Find teammates in the same position who are injured/doubtful
  const injuredRivals = allPlayers.filter(
    (p) =>
      p.team === player.team &&
      p.element_type === player.element_type &&
      p.id !== player.id &&
      (p.chance_of_playing ?? 100) < 75 && // Doubtful or worse
      p.minutes > player.minutes  // They were playing more (i.e. the "starter")
  );

  if (injuredRivals.length === 0) return 1.0;

  // The more injured starters ahead of them, the bigger the opportunity.
  // Cap at 1.25 (25% boost) to avoid over-weighting this uncertain signal.
  const bonus = Math.min(1.25, 1.0 + injuredRivals.length * 0.12);
  return bonus;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Calculate composite scores for ALL players.
 *
 * Players are grouped by position before normalisation, so a goalkeeper's
 * stats are compared to other goalkeepers (not to strikers who naturally
 * score more goals).
 *
 * Defensive positions (GKP, DEF) use a different weight set that includes
 * xGC per 90 (expected goals conceded) as a measure of defensive solidity.
 *
 * After the weighted sum, two adjustments are applied:
 * - Injury penalty: reduces score based on chance_of_playing_next_round
 * - Opportunity bonus: small boost for bench players whose rival is injured
 *
 * @param {Array} players - Array of normalised player objects (from transforms.js)
 * @param {number} completedGws - How many gameweeks have finished
 * @returns {Array} - Same players array, but each player now has:
 *                     compositeScore (number), scoreBreakdown (object),
 *                     injuryMultiplier (number), opportunityMultiplier (number)
 */
export function calculateCompositeScores(players, completedGws) {
  // Determine if we should apply early-season discounts
  const isEarlySeason = completedGws < EARLY_SEASON_THRESHOLD;

  // Group players by position
  const groups = { 1: [], 2: [], 3: [], 4: [] };
  for (const player of players) {
    const posGroup = groups[player.element_type];
    if (posGroup) posGroup.push(player);
  }

  // Process each position group separately
  const scoredPlayers = [];

  for (const positionType of [1, 2, 3, 4]) {
    const group = groups[positionType];
    if (group.length === 0) continue;

    // Choose weights based on position: GKP (1) and DEF (2) use defensive weights
    const isDefensive = positionType <= 2;
    const weights = isDefensive ? WEIGHTS_DEFENCE : WEIGHTS_ATTACK;

    // Step 1: Calculate raw metric values for each player in the group.
    // Every value is coerced through (|| 0) to prevent NaN from propagating
    // through normalisation and producing an unsortable composite score.
    const rawMetrics = group.map((player) => ({
      player,
      fixtureScore: calcFixtureScore(player.upcoming_fdr, 5) || 0,
      ptsPer90:     player.pts_per_90     || 0,
      ict:          player.ict_num        || 0,
      xgiPer90:     player.xgi_per_90     || 0,
      xgcPer90:     player.xgc_per_90     || 0,
      nailedness:   calcNailedness(player.minutes || 0, completedGws),
      form:         player.form_num       || 0,
    }));

    // Step 2: Find min and max for each metric within the group
    const ranges = {
      fixtureScore: getRange(rawMetrics, "fixtureScore"),
      ptsPer90:     getRange(rawMetrics, "ptsPer90"),
      ict:          getRange(rawMetrics, "ict"),
      xgiPer90:     getRange(rawMetrics, "xgiPer90"),
      xgcPer90:     getRange(rawMetrics, "xgcPer90"),
      nailedness:   getRange(rawMetrics, "nailedness"),
      form:         getRange(rawMetrics, "form"),
    };

    // Step 3: Normalise and score each player
    for (const { player, fixtureScore, ptsPer90, ict, xgiPer90, xgcPer90, nailedness, form } of rawMetrics) {
      // Normalise each metric to 0-100 within the position group
      const normFixture = minMaxNorm(fixtureScore, ranges.fixtureScore.min, ranges.fixtureScore.max);
      const normPts     = minMaxNorm(ptsPer90, ranges.ptsPer90.min, ranges.ptsPer90.max);
      const normIct     = minMaxNorm(ict, ranges.ict.min, ranges.ict.max);
      const normXgi     = minMaxNorm(xgiPer90, ranges.xgiPer90.min, ranges.xgiPer90.max);
      // xGC is INVERTED: lower conceded = higher score
      const normXgc     = invertedMinMaxNorm(xgcPer90, ranges.xgcPer90.min, ranges.xgcPer90.max);
      const normMinutes = minMaxNorm(nailedness, ranges.nailedness.min, ranges.nailedness.max);
      const normForm    = minMaxNorm(form, ranges.form.min, ranges.form.max);

      // Apply early-season discounts if applicable
      const d = isEarlySeason ? EARLY_SEASON_DISCOUNTS : {};
      const discountedFixture = normFixture * (d.fixtureDifficulty ?? 1);
      const discountedPts     = normPts     * (d.pointsPer90 ?? 1);
      const discountedIct     = normIct     * (d.ictIndex ?? 1);
      const discountedXgi     = normXgi     * (d.xgiPer90 ?? 1);
      const discountedXgc     = normXgc     * (d.xgcPer90 ?? 1);
      const discountedMinutes = normMinutes * (d.minutesPlayed ?? 1);
      const discountedForm    = normForm    * (d.form ?? 1);

      // Weighted sum using position-appropriate weights
      const rawComposite =
        discountedFixture * weights.fixtureDifficulty +
        discountedPts     * weights.pointsPer90 +
        discountedIct     * weights.ictIndex +
        discountedXgi     * weights.xgiPer90 +
        discountedXgc     * weights.xgcPer90 +
        discountedMinutes * weights.minutesPlayed +
        discountedForm    * weights.form;

      // Step 4: Apply injury penalty (reduces score for doubtful/injured players)
      // Default to 100 (fully fit) if chance_of_playing is missing/NaN
      const injuryMultiplier = calcInjuryPenalty(player.chance_of_playing ?? 100);

      // Step 5: Apply opportunity bonus (boosts bench players whose rival is injured)
      const opportunityMultiplier = calcOpportunityBonus(player, players, completedGws);

      // Final composite = raw score * injury penalty * opportunity bonus.
      // The isNaN fallback is a safety net: if anything upstream produced NaN
      // (e.g. an unexpected API field type), we clamp to 0 so sorting still works.
      const rawFinal = rawComposite * injuryMultiplier * opportunityMultiplier;
      const compositeScore = isNaN(rawFinal) ? 0 : rawFinal;

      // Store the breakdown so the UI can show WHY a player scored high/low
      const scoreBreakdown = {
        fixtureDifficulty: Math.round(discountedFixture * 10) / 10,
        pointsPer90:       Math.round(discountedPts * 10) / 10,
        ictIndex:          Math.round(discountedIct * 10) / 10,
        xgiPer90:          Math.round(discountedXgi * 10) / 10,
        ...(isDefensive ? { xgcPer90: Math.round(discountedXgc * 10) / 10 } : {}),
        minutesPlayed:     Math.round(discountedMinutes * 10) / 10,
        form:              Math.round(discountedForm * 10) / 10,
        injuryPenalty:     Math.round(injuryMultiplier * 100) / 100,
        opportunityBonus:  Math.round(opportunityMultiplier * 100) / 100,
      };

      scoredPlayers.push({
        ...player,
        compositeScore:        Math.round(compositeScore * 10) / 10,
        rawCompositeScore:     Math.round(rawComposite * 10) / 10, // Before adjustments
        injuryMultiplier:      Math.round(injuryMultiplier * 100) / 100,
        opportunityMultiplier: Math.round(opportunityMultiplier * 100) / 100,
        scoreBreakdown,
      });
    }
  }

  // Sort by composite score (highest first) for convenience
  scoredPlayers.sort((a, b) => b.compositeScore - a.compositeScore);

  return scoredPlayers;
}

// ---------------------------------------------------------------------------
// Captaincy scoring (single-gameweek focus)
// ---------------------------------------------------------------------------

/**
 * Calculate a single-GW captaincy score for each player.
 * This weights the next fixture difficulty and form more heavily
 * than the standard composite score, because we only care about
 * the next game (not the next 5 weeks).
 *
 * Injury penalty is applied MORE aggressively for captaincy (squared)
 * because a captain who doesn't play wastes your most valuable chip.
 *
 * Weights for captaincy:
 *   Next fixture FDR: 35%
 *   Form: 25%
 *   xGI per 90: 20%
 *   ICT: 10%
 *   Points per 90: 10%
 *
 * Returns both captain and vice-captain recommendations.
 * Vice-captain is ranked purely on merit (own captaincy score),
 * since they are a standalone pick.
 *
 * @param {Array} players - Normalised player array
 * @param {Object} options - { squadOnly: boolean } -- if true, only squad players
 * @param {Set} [squadIds] - Set of player IDs in the user's squad
 * @returns {Object} - { captains: Array, viceCaptains: Array }
 */
export function calculateCaptaincyScores(players, options = {}, squadIds = null) {
  const { squadOnly = true } = options;

  // Filter by squad membership if requested
  let pool = players;
  if (squadOnly && squadIds) {
    pool = players.filter((p) => squadIds.has(p.id));
  }

  // Only consider players who actually play (decent minutes)
  const eligible = pool.filter((p) => p.minutes >= 90);

  const scored = eligible.map((player) => {
    // For captaincy, we only care about the NEXT fixture (not 5)
    const nextFdr = player.upcoming_fdr?.[0] ?? 3;
    const fdrScore = ((5 - nextFdr) / 4) * 100;

    // Raw captaincy score from weighted components
    const rawCaptaincyScore =
      fdrScore * 0.35 +
      (player.form_num / 10) * 100 * 0.25 +
      Math.min(100, player.xgi_per_90 * 20) * 0.20 +
      Math.min(100, player.ict_num / 5) * 0.10 +
      Math.min(100, player.pts_per_90 * 10) * 0.10;

    // Apply AGGRESSIVE injury penalty for captaincy.
    // A captain with 50% chance of playing is very risky because
    // if they don't play, your captaincy is wasted or falls to VC.
    // Using power of 2.0 (steeper than composite's 1.5):
    //   75% -> 0.56, 50% -> 0.25, 25% -> 0.06
    const chanceOfPlaying = player.chance_of_playing ?? 100;
    let captaincyInjuryMultiplier = 1.0;
    if (chanceOfPlaying < 100) {
      if (chanceOfPlaying <= 0) {
        captaincyInjuryMultiplier = 0.02; // Near-zero but visible
      } else {
        const fraction = chanceOfPlaying / 100;
        captaincyInjuryMultiplier = 0.02 + Math.pow(fraction, 2.0) * 0.98;
      }
    }

    const captaincyScore = rawCaptaincyScore * captaincyInjuryMultiplier;

    // Track whether this player is in the user's squad
    const inSquad = squadIds ? squadIds.has(player.id) : true;

    return {
      ...player,
      captaincyScore:            Math.round(captaincyScore * 10) / 10,
      rawCaptaincyScore:         Math.round(rawCaptaincyScore * 10) / 10,
      captaincyInjuryMultiplier: Math.round(captaincyInjuryMultiplier * 100) / 100,
      nextFixture:               player.upcoming_fixtures?.[0] || null,
      inSquad,
    };
  });

  // Sort by captaincy score (highest first)
  scored.sort((a, b) => b.captaincyScore - a.captaincyScore);

  // Captain picks = top 10
  const captains = scored.slice(0, 10);

  // Vice-captain picks = also top 10, ranked purely on merit.
  // In the UI the user pairs them with their chosen captain.
  const viceCaptains = scored.slice(0, 10);

  return { captains, viceCaptains, allScored: scored };
}

// ---------------------------------------------------------------------------
// Best Starting XI selector
// ---------------------------------------------------------------------------

/**
 * Valid FPL formations. Each specifies how many DEF, MID, FWD start.
 * GKP is always 1. The bench always has 1 GKP + 3 outfield.
 */
const VALID_FORMATIONS = [
  { name: "3-4-3", def: 3, mid: 4, fwd: 3 },
  { name: "3-5-2", def: 3, mid: 5, fwd: 2 },
  { name: "4-4-2", def: 4, mid: 4, fwd: 2 },
  { name: "4-3-3", def: 4, mid: 3, fwd: 3 },
  { name: "4-5-1", def: 4, mid: 5, fwd: 1 },
  { name: "5-4-1", def: 5, mid: 4, fwd: 1 },
  { name: "5-3-2", def: 5, mid: 3, fwd: 2 },
];

/**
 * Given 15 players, find the best starting XI and formation.
 *
 * NEW LOGIC: Prioritises the best individual player at each position
 * rather than testing all formations for the highest total score.
 *
 * How it works:
 * 1. Sort each position group by the chosen sortKey (compositeScore,
 *    projectedPoints, or blendedScore).
 * 2. For each valid formation, pick the top N players from each position.
 *    Because groups are sorted best-first, this guarantees the best
 *    individual player at each position always starts.
 * 3. Among all valid formations, pick the one whose starting XI has the
 *    highest total score (this handles the edge case where formations
 *    differ in how many slots each position gets).
 *
 * The key difference from the old logic: previously, a formation that
 * spread points evenly could beat one that started a star player.
 * Now, the star always starts -- the formation wraps around them.
 *
 * @param {Array} squadPlayers - Array of 15 player objects with score fields
 * @param {string} [sortKey="compositeScore"] - Which metric to sort/rank by
 * @param {Array|null} [lockedFormation=null] - Optional formation to lock in,
 *   e.g. [4, 3, 3] for 4-3-3. When provided, only that formation is tested
 *   instead of all 7 valid formations. Pass null or omit for auto-select.
 * @returns {Object} - {
 *   formation: string (e.g. "4-3-3"),
 *   startingXI: Array of 11 players,
 *   bench: Array of 4 players (ordered by score),
 *   totalScore: number
 * }
 */
export function selectBestXI(squadPlayers, sortKey = "compositeScore", lockedFormation = null) {
  if (!squadPlayers || squadPlayers.length === 0) {
    return { formation: "---", startingXI: [], bench: [], totalScore: 0 };
  }

  // Group by position and sort each group by the chosen metric (best first)
  const gkps = squadPlayers
    .filter((p) => p.position_name === "GKP")
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const defs = squadPlayers
    .filter((p) => p.position_name === "DEF")
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const mids = squadPlayers
    .filter((p) => p.position_name === "MID")
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const fwds = squadPlayers
    .filter((p) => p.position_name === "FWD")
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

  let bestFormation = null;
  let bestScore = -Infinity;
  let bestXI = [];
  let bestBench = [];

  // Determine which formations to test.
  // If the caller locked a specific formation (e.g. [4, 3, 3]),
  // only test that one. Otherwise test all 7 valid FPL formations
  // and pick the one with the highest total score.
  const formationsToTest = lockedFormation
    ? VALID_FORMATIONS.filter(
        (f) =>
          f.def === lockedFormation[0] &&
          f.mid === lockedFormation[1] &&
          f.fwd === lockedFormation[2]
      )
    : VALID_FORMATIONS;

  for (const formation of formationsToTest) {
    // Check if we have enough players for this formation
    if (defs.length < formation.def) continue;
    if (mids.length < formation.mid) continue;
    if (fwds.length < formation.fwd) continue;
    if (gkps.length < 1) continue;

    // Pick the best N from each position for this formation
    // Because each group is sorted by sortKey, position 0 = best player
    const startGkp = gkps.slice(0, 1);
    const startDef = defs.slice(0, formation.def);
    const startMid = mids.slice(0, formation.mid);
    const startFwd = fwds.slice(0, formation.fwd);

    const xi = [...startGkp, ...startDef, ...startMid, ...startFwd];
    const totalScore = xi.reduce((sum, p) => sum + (p[sortKey] || 0), 0);

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestFormation = formation.name;
      bestXI = xi;

      // Bench = everyone not in the XI, sorted by the same metric
      const xiIds = new Set(xi.map((p) => p.id));
      bestBench = squadPlayers
        .filter((p) => !xiIds.has(p.id))
        .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
    }
  }

  return {
    formation: bestFormation || "---",
    startingXI: bestXI,
    bench: bestBench,
    totalScore: Math.round(bestScore * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Blend score: 50/50 normalised mix of composite and projected
// ---------------------------------------------------------------------------

/**
 * Calculate a blended score for a set of players.
 *
 * Composite is already 0-100 (position-normalised). Projected points
 * varies by horizon and position, so we min-max normalise it within
 * the provided pool to 0-100, then average the two.
 *
 * The blend answers "who is both statistically strong AND likely to
 * score actual points?" -- a middle ground between the two metrics.
 *
 * @param {Array} players - Players to score (must already have
 *   compositeScore and projectedPoints)
 * @returns {Array} - Same players with `blendedScore` attached
 */
export function calculateBlendedScores(players) {
  if (!players.length) return players;

  // Find projected points range within this pool
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const p of players) {
    const pp = p.projectedPoints || 0;
    if (pp < minProj) minProj = pp;
    if (pp > maxProj) maxProj = pp;
  }

  return players.map((p) => {
    const composite = p.compositeScore || 0;
    // Normalise projected points to 0-100 within this pool
    const normProjected = minMaxNorm(p.projectedPoints || 0, minProj, maxProj);
    // 50/50 blend
    const blendedScore = Math.round(((composite + normProjected) / 2) * 10) / 10;
    return { ...p, blendedScore };
  });
}

/**
 * Calculate blended scores using POSITION-GROUP normalisation.
 *
 * Composite scores are already normalised within position groups (GKP, DEF,
 * MID, FWD). To keep the blend fair, projected points must also be normalised
 * within each position group rather than globally. Without this, forwards
 * (who naturally score more points) would dominate the projected-points
 * component and inflate their blend relative to goalkeepers/defenders.
 *
 * Process:
 * 1. Separate qualified players (45+ season minutes) into position groups
 * 2. Find the min/max projected points within EACH group
 * 3. Normalise each player's projected points against their own group's range
 * 4. Blend: 50/50 average of composite (already position-normalised) and
 *    position-normalised projected points
 *
 * Called in FplContext.loadData after composite and projected scores are set.
 * After this runs, every player has a stable `blendedScore` that does not
 * change based on filtering context.
 *
 * @param {Array} allPlayers - All ~700 players (must already have
 *   compositeScore and projectedPoints)
 * @returns {Array} - Same players with `blendedScore` attached
 */
export function calculateGlobalBlendedScores(allPlayers) {
  // Only players with meaningful season minutes contribute to normalisation ranges
  const qualified = allPlayers.filter((p) => (p.minutes || 0) >= 45);
  if (!qualified.length) return allPlayers;

  // Build min/max projected points per position group.
  // Each group gets its own normalisation range so a GKP projecting 3.0
  // isn't compared against a FWD projecting 8.0.
  const positionGroups = ["GKP", "DEF", "MID", "FWD"];
  const ranges = {};

  for (const pos of positionGroups) {
    const groupPlayers = qualified.filter((p) => p.position_name === pos);
    if (!groupPlayers.length) {
      // No qualified players in this position -- use neutral range
      ranges[pos] = { min: 0, max: 0 };
      continue;
    }
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (const p of groupPlayers) {
      const pp = p.projectedPoints || 0;
      if (pp < minProj) minProj = pp;
      if (pp > maxProj) maxProj = pp;
    }
    ranges[pos] = { min: minProj, max: maxProj };
  }

  // Apply blend to every player using their position group's range.
  // Players below 45 minutes still get a blend score (using their group's
  // range) so the field is never undefined, but their composite is typically
  // 0 and their projection low, so the blend will be low too.
  return allPlayers.map((p) => {
    const pos = p.position_name || "MID"; // fallback to MID if somehow missing
    const range = ranges[pos] || ranges["MID"];
    const composite = p.compositeScore || 0;
    const normProjected = minMaxNorm(p.projectedPoints || 0, range.min, range.max);
    const blendedScore = Math.round(((composite + normProjected) / 2) * 10) / 10;
    return { ...p, blendedScore };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the min and max values for a given metric across a group of players.
 */
function getRange(items, key) {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    if (item[key] < min) min = item[key];
    if (item[key] > max) max = item[key];
  }
  return { min, max };
}
