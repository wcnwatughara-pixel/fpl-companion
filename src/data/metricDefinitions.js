/**
 * metricDefinitions.js -- Single source of truth for every metric in the app
 *
 * Each entry has:
 *   key:         unique identifier used to look up definitions
 *   name:        display name
 *   short:       one-liner for tooltips (aim for ~15 words max)
 *   long:        detailed explanation for the glossary page
 *   category:    grouping key for the glossary page layout
 *
 * Categories:
 *   "dashboard"  -- Summary-level team/manager stats on the Dashboard
 *   "raw"        -- Stats pulled directly from the FPL API
 *   "derived"    -- Stats calculated from raw data (per-90 rates, etc.)
 *   "scoring"    -- Composite, projected, blend, captaincy scores
 *   "projection" -- Components of the projection system
 *   "controls"   -- UI controls that affect rankings (sort mode, strategy, etc.)
 *   "visual"     -- Color systems and visual conventions
 *   "accuracy"   -- Metrics for measuring prediction accuracy
 *   "team"       -- Team-level contextual metrics (PPDU, exports)
 *   "squad"      -- Squad management features (auto-subs, transfers)
 *   "planning"   -- Planning tools (formation selector, wildcard)
 *   "fixtures"   -- Fixture-related color systems and conventions
 */

const METRIC_DEFINITIONS = [
  // -----------------------------------------------------------------------
  // Dashboard summary stats
  // -----------------------------------------------------------------------
  {
    key: "totalPoints",
    name: "Total Points",
    short: "Your cumulative FPL points across all gameweeks so far.",
    long: "The total number of FPL points your team has earned across every gameweek played this season. This is the primary measure of overall performance and determines your rank.",
    category: "dashboard",
  },
  {
    key: "overallRank",
    name: "Overall Rank",
    short: "Your position among all FPL managers worldwide.",
    long: "Where you sit in the global FPL standings. Rank 1 is the best manager in the world. This updates after each gameweek based on your total points.",
    category: "dashboard",
  },
  {
    key: "gwPoints",
    name: "GW Points",
    short: "Points your team scored in the most recent gameweek.",
    long: "The points your starting XI (plus any auto-substitutions) earned in the last completed gameweek. Captain points are doubled. This does not include bench players unless they were auto-subbed in.",
    category: "dashboard",
  },
  {
    key: "squadValue",
    name: "Squad Value",
    short: "Total selling price of all 15 players in your squad.",
    long: "The combined current value of your 15-player squad. Player prices change based on transfers in/out across all FPL managers. If a player's price rises after you buy them, you receive half the profit when selling (rounded down to 0.1m).",
    category: "dashboard",
  },
  {
    key: "bank",
    name: "Bank",
    short: "Money available to spend on transfers.",
    long: "Funds sitting in your FPL bank, available for buying players. Your total budget is squad value + bank. The maximum possible is 100.0m at the start of the season.",
    category: "dashboard",
  },

  // -----------------------------------------------------------------------
  // Raw stats (from FPL API, normalised in transforms.js)
  // -----------------------------------------------------------------------
  {
    key: "form",
    name: "Form",
    short: "Average points per game over the last 4 gameweeks.",
    long: "A rolling average of FPL points scored per game over roughly the last 4 completed gameweeks. Higher form means the player has been delivering points recently. This is one of the most volatile stats early in the season when the sample is tiny.",
    category: "raw",
  },
  {
    key: "totalPlayerPoints",
    name: "Total Points",
    short: "Total FPL points this player has scored all season.",
    long: "The cumulative FPL points this player has earned across all gameweeks. Includes goals, assists, clean sheets, bonus points, and deductions for cards/own goals. Useful for gauging season-long consistency but can be misleading if a player had one big haul and was quiet otherwise.",
    category: "raw",
  },
  {
    key: "price",
    name: "Price",
    short: "Current cost to buy this player (in millions).",
    long: "The player's current transfer price in the FPL game. Prices fluctuate based on transfer activity across all managers. A rising price means the player is popular; a falling price means managers are selling. Your budget must cover the price to bring them in.",
    category: "raw",
  },
  {
    key: "minutes",
    name: "Minutes",
    short: "Total minutes played across all gameweeks this season.",
    long: "How many minutes the player has been on the pitch this season. A player who plays every minute of every game would have (gameweeks * 90). Low minutes could mean injury, rotation, or being a substitute. This feeds into the nailedness calculation.",
    category: "raw",
  },
  {
    key: "ictIndex",
    name: "ICT Index",
    short: "FPL's measure of Influence, Creativity, and Threat combined.",
    long: "A composite stat from FPL itself that measures three things: Influence (impact on a match), Creativity (chance creation for teammates), and Threat (likelihood of scoring). Higher ICT means the player is more involved in attacking play. Useful as a leading indicator since high ICT tends to convert into points over time.",
    category: "raw",
  },
  {
    key: "xg",
    name: "xG (Expected Goals)",
    short: "Statistical estimate of goals this player should have scored.",
    long: "Expected goals measures the quality of scoring chances a player has had. Each shot is assigned a probability of being scored based on distance, angle, body part, and assist type. An xG of 3.5 means the average player would have scored about 3.5 goals from those chances. If actual goals exceed xG, the player is overperforming (which may not be sustainable).",
    category: "raw",
  },
  {
    key: "xa",
    name: "xA (Expected Assists)",
    short: "Statistical estimate of assists this player should have provided.",
    long: "Expected assists measures the quality of chances a player creates for teammates. Each key pass is assigned a probability based on the resulting shot's xG. An xA of 2.0 means the average creator would have tallied about 2 assists from those passes.",
    category: "raw",
  },
  {
    key: "xgi",
    name: "xGI (Expected Goal Involvements)",
    short: "Combined xG + xA: total expected attacking output.",
    long: "The sum of expected goals and expected assists (xG + xA). This is the best single measure of a player's total attacking contribution. A midfielder with xGI of 5.0 has been creating and shooting at a level that would typically produce 5 goal involvements.",
    category: "raw",
  },
  {
    key: "xgc",
    name: "xGC (Expected Goals Conceded)",
    short: "Goals the player's team is expected to have conceded while they played.",
    long: "Expected goals conceded while this player was on the pitch. Lower is better. Primarily relevant for goalkeepers and defenders since their FPL points depend heavily on clean sheets. A GKP/DEF on a team with low xGC is more likely to earn clean sheet points.",
    category: "raw",
  },
  {
    key: "cleanSheets",
    name: "Clean Sheets",
    short: "Games where the player's team conceded zero goals (GKP/DEF get points).",
    long: "The number of matches in which the player's team did not concede a goal while the player was on the pitch for at least 60 minutes. Goalkeepers earn 4 points and defenders earn 4 points per clean sheet. Midfielders earn 1 point. Forwards get nothing.",
    category: "raw",
  },
  {
    key: "ownership",
    name: "Ownership",
    short: "Percentage of all FPL managers who own this player.",
    long: "The proportion of all FPL teams that currently have this player in their squad. High ownership (e.g., 40%+) means the player is a 'must-have' and not owning them is a risk if they score big. Low ownership means they are a differential pick that can gain you rank if they deliver.",
    category: "raw",
  },
  {
    key: "availability",
    name: "Availability",
    short: "Chance the player will play in the next gameweek (0-100%).",
    long: "The FPL-reported probability that this player will feature in the next match. 100% means fully fit and expected to play. 75% means probable. 50% means doubtful. 25% means unlikely. 0% means ruled out (injured, suspended, or otherwise unavailable). This directly affects composite score via an injury penalty and projected points via an availability multiplier.",
    category: "raw",
  },
  {
    key: "status",
    name: "Status",
    short: "Player's current availability status and any injury/suspension news.",
    long: "The FPL status flag for the player. 'Available' means no known issues. Other statuses include injured, suspended, on loan, or left the league. When a player is not fully available, the associated news text explains why (e.g., 'Hamstring - Expected back 15 Oct').",
    category: "raw",
  },

  // -----------------------------------------------------------------------
  // Derived stats (calculated from raw data)
  // -----------------------------------------------------------------------
  {
    key: "ptsPer90",
    name: "Pts/90",
    short: "FPL points scored per 90 minutes played.",
    long: "Total FPL points divided by (total minutes / 90). This normalises for playing time so you can fairly compare a player who plays 90 minutes every week to one who gets subbed on for 20. Higher is better. Only calculated when a player has at least 45 minutes total (otherwise too noisy).",
    category: "derived",
  },
  {
    key: "xgiPer90",
    name: "xGI/90",
    short: "Expected goal involvements per 90 minutes.",
    long: "Expected goal involvements (xG + xA) normalised to a per-90-minute rate. Removes the bias of total minutes played. A player with 0.6 xGI/90 is involved in roughly one goal contribution every 150 minutes. This is a key component of composite scoring for attackers.",
    category: "derived",
  },
  {
    key: "xgcPer90",
    name: "xGC/90",
    short: "Expected goals conceded per 90 minutes (lower is better for defenders).",
    long: "Expected goals conceded per 90 minutes while this player was on the pitch. Lower values indicate better defensive solidity. This metric is inverted in the composite score (lower xGC/90 = higher score) and only used for GKP and DEF positions. A centre-back on a team conceding 0.8 xGC/90 is on a defensively strong side.",
    category: "derived",
  },
  {
    key: "nailedness",
    name: "Nailedness (Minutes Share)",
    short: "How regularly the player starts, based on minutes played vs. available.",
    long: "Calculated as (total minutes played) / (completed gameweeks * 90) * 100. A score of 100 means the player has played every single minute of every game. A score of 50 means they have played about half the available minutes (rotation risk or substitute). This affects both composite score (via the minutes weight) and projected points (via the nailedness factor).",
    category: "derived",
  },

  // -----------------------------------------------------------------------
  // Scoring metrics
  // -----------------------------------------------------------------------
  {
    key: "compositeScore",
    name: "Composite Score",
    short: "Overall 0-100 rating combining fixtures, form, stats, and availability.",
    long: "A weighted 0-100 score that ranks how good a pick this player is right now. Players are compared within their position group (GKP vs GKP, FWD vs FWD) so the scale is fair. Components and weights for attackers (MID/FWD): fixture difficulty 28%, pts/90 20%, xGI/90 18%, ICT 12%, minutes 12%, form 10%. For defenders (GKP/DEF): fixture difficulty 25%, pts/90 17%, xGC/90 15%, minutes 12%, form 11%, xGI/90 10%, ICT 10%. An injury penalty is then applied (reduces score for doubtful/injured players) and an opportunity bonus can boost bench players whose positional rival is injured. Early in the season, volatile stats like form are discounted so fixtures carry more influence.",
    category: "scoring",
  },
  {
    key: "projectedPoints",
    name: "Projected Points",
    short: "Estimated FPL points over your chosen gameweek horizon.",
    long: "An absolute estimate of how many FPL points a player will score over the next N gameweeks (you control N with the 'Proj GWs' selector). The calculation blends two baselines (points per game and pts/90), adjusts for upcoming fixture difficulty, scales by availability, and accounts for nailedness (rotation risk). Unlike composite score which is relative (0-100 within a position), projected points is absolute: a projection of 25.0 over 5 GWs means roughly 5.0 points per game.",
    category: "scoring",
  },
  {
    key: "projectedPerGame",
    name: "Projected Per Game",
    short: "Projected points divided by the number of gameweeks in the horizon.",
    long: "The per-game version of projected points: total projection divided by the number of gameweeks. Used in captaincy mode because captain selection is a single-gameweek decision. A player with 6.2 projected per game is expected to outscore one with 4.8 in the next match.",
    category: "scoring",
  },
  {
    key: "blendedScore",
    name: "Blend Score",
    short: "50/50 mix of composite score and projected points, both normalised to 0-100.",
    long: "A middle-ground metric that answers 'who is both statistically strong AND likely to score actual points?' Composite score is already 0-100. Projected points is min-max normalised within the visible player pool to 0-100, then the two are averaged. The blend is relative to whatever filters you have active (position, price), so it adapts to the group you are comparing.",
    category: "scoring",
  },
  {
    key: "captaincyScore",
    name: "Captaincy Score",
    short: "Single-gameweek captain rating with aggressive injury penalty.",
    long: "A 0-100 score tuned specifically for picking a captain. Weights: next fixture FDR 35%, form 25%, xGI/90 20%, ICT 10%, pts/90 10%. The injury penalty is steeper than composite (squared instead of 1.5 power) because a captain who does not play wastes your most valuable point-doubling opportunity. A 50% availability player scores just 25% of their raw captaincy score.",
    category: "scoring",
  },
  {
    key: "vcScore",
    name: "VC Score",
    short: "Vice-captain ranking, same formula as captaincy score.",
    long: "Vice-captain picks are ranked using the same captaincy score formula. The VC is your insurance policy: if the captain does not play, points are doubled for the VC instead. Pick someone who is both high-scoring and highly likely to play.",
    category: "scoring",
  },

  // -----------------------------------------------------------------------
  // Projection breakdown components
  // -----------------------------------------------------------------------
  {
    key: "projBaseRate",
    name: "Base Rate",
    short: "Blended points-per-game baseline before fixture/availability adjustments.",
    long: "The starting point of the projection: a weighted blend of points per game (60%) and pts/90 (40%). PPG gets more weight because it captures FPL-specific scoring like bonus points that per-90 raw stats miss. If a player has fewer than 180 minutes (roughly 2 full games), the system uses PPG alone since per-90 data is too noisy.",
    category: "projection",
  },
  {
    key: "projFixtureMultiplier",
    name: "Fixture Multiplier",
    short: "Adjusts projection up or down based on upcoming fixture difficulty.",
    long: "The average FDR (fixture difficulty rating) of the next N fixtures is converted to a multiplier. FDR 1 (easiest) gives a 1.24x boost. FDR 3 (neutral) gives 1.0x. FDR 5 (hardest) gives 0.76x. The formula is: 1 + (3 - avgFDR) * 0.12. The 0.12 coefficient is intentionally conservative because even great players score against tough opponents.",
    category: "projection",
  },
  {
    key: "projAvailability",
    name: "Availability Factor",
    short: "Linear scaling by chance of playing (75% available = 0.75x output).",
    long: "The projection is multiplied by (chance_of_playing / 100). This is a linear scale (unlike composite score's quadratic penalty) because projected points estimates expected value: a 75% chance of playing means 75% of expected output on average. A fully fit player has a 1.0 factor.",
    category: "projection",
  },
  {
    key: "projNailedness",
    name: "Nailedness Factor",
    short: "Adjusts for rotation risk based on minutes share.",
    long: "Accounts for whether a player actually starts or just comes off the bench. Formula: 0.5 + (minutesFraction * 0.5), where minutesFraction = minutes / (completedGWs * 90), capped at 1.0. A player who has played every minute gets 1.0. A player with ~60% of minutes gets 0.8. A player who barely plays gets closer to 0.5. This prevents projecting full points for a 10-minute cameo player.",
    category: "projection",
  },

  // -----------------------------------------------------------------------
  // Controls and filters
  // -----------------------------------------------------------------------
  {
    key: "sortMode",
    name: "Sort By",
    short: "Which metric drives the player ranking in the current view.",
    long: "Controls which score is used to rank players. 'Composite' ranks by the multi-factor 0-100 score. 'Projected' ranks by absolute projected FPL points. 'Blend' ranks by the 50/50 normalised mix of both. Each has a use case: composite for overall quality, projected for expected points, blend for a balanced view.",
    category: "controls",
  },
  {
    key: "projHorizon",
    name: "Proj GWs (Projection Horizon)",
    short: "How many future gameweeks the projected points cover.",
    long: "Sets how far ahead the projection looks. A 1 GW horizon is useful for captain picks and immediate transfers. A 5-6 GW horizon is better for wildcard planning where you want players who will deliver over several weeks. The projection scales roughly linearly with horizon (a player projected for 5.0/game over 5 GWs gets 25.0 total).",
    category: "controls",
  },
  {
    key: "maxPrice",
    name: "Max Price Filter",
    short: "Only show players at or below this price.",
    long: "Filters the player list to those costing at most the selected amount. The slider auto-adjusts its maximum to the most expensive player in the game (rounded up to the nearest 0.5m) so no one is accidentally hidden. Useful for finding value picks within a budget.",
    category: "controls",
  },
  {
    key: "strategy",
    name: "Strategy (Wildcard)",
    short: "Tilts auto-fill toward premium, budget, or balanced squad building.",
    long: "Controls how the wildcard auto-fill distributes your budget. 'Balanced' picks the best available player regardless of price. 'Premium' boosts players costing 10.0m+ by 1.35x and penalises those under 6.0m by 0.75x, favouring star players whose big hauls you cannot afford to miss. 'Budget' does the inverse (1.3x boost under 6.0m, 0.7x penalty for 10.0m+), spreading value across all positions. The multiplier nudges rankings without overriding the base metric: a cheap player with a high composite can still beat an expensive one with a low score.",
    category: "controls",
  },
  {
    key: "premiumPositions",
    name: "Premium Positions",
    short: "Which positions to apply the premium boost to (Wildcard only).",
    long: "When strategy is set to 'Premium', you can optionally target specific positions. For example, selecting MID and FWD means only midfielders and forwards get the premium price boost, while GKP and DEF are ranked neutrally. If no positions are selected, the premium boost applies globally. This lets you build a squad with premium attackers and budget defenders (or any combination).",
    category: "controls",
  },

  // -----------------------------------------------------------------------
  // Visual conventions / color systems
  // -----------------------------------------------------------------------
  {
    key: "scoreBarColors",
    name: "Score Bar Colors",
    short: "Green = strong (70+), amber = decent (50-69), orange = weak (30-49), red = poor (below 30).",
    long: "The colored bar next to composite, blend, and captaincy scores uses a four-tier color system: green (70+) indicates a strong pick, amber/yellow (50-69) is decent, orange (30-49) is below average, and red (below 30) is a poor pick. The bar fills proportionally to the score out of 100.",
    category: "visual",
  },
  {
    key: "positionBadgeColors",
    name: "Position Badge Colors",
    short: "GKP = yellow, DEF = green, MID = blue, FWD = red.",
    long: "Each position has a consistent color badge throughout the app: Goalkeeper (GKP) is yellow, Defender (DEF) is green, Midfielder (MID) is blue, and Forward (FWD) is red. These match common FPL community conventions.",
    category: "visual",
  },
  {
    key: "fixtureDifficultyColors",
    name: "Fixture Difficulty Colors",
    short: "Green = easy fixture, grey = neutral, red = hard fixture.",
    long: "The fixture difficulty rating (FDR) from 1-5 is shown as colored blocks in the 'Next 5' fixture strip. FDR 1-2 (easy) appears green, FDR 3 (neutral) appears grey, FDR 4-5 (hard) appears red/dark red. Home fixtures show the opponent in CAPS; away fixtures are lowercase. A run of green fixtures means favourable games ahead.",
    category: "visual",
  },
  {
    key: "projectedPointsColor",
    name: "Projected Points Color",
    short: "Purple text distinguishes projected points from composite scores (green).",
    long: "Projected points and per-game projections are displayed in purple throughout the app. This visually separates them from composite scores (shown in green) and blend scores (shown in cyan). When you see a purple number, it represents an absolute FPL point estimate, not a 0-100 relative ranking.",
    category: "visual",
  },
  {
    key: "blendScoreColor",
    name: "Blend Score Color",
    short: "Cyan text marks blend scores in search results and lists.",
    long: "In the Wildcard search results and similar lists, blend scores appear in cyan/teal to distinguish them from composite (green) and projected (purple). The color coding helps you quickly identify which metric you are looking at without reading labels.",
    category: "visual",
  },
  {
    key: "injuryBadge",
    name: "Injury/Availability Badge",
    short: "Amber badge shows the player's chance of playing when below 100%.",
    long: "When a player is not fully fit, a small amber badge appears next to their name showing their availability percentage (e.g., '75%'). This is sourced from the FPL API's 'chance of playing next round' field. 100% (fully fit) shows no badge. The lower the percentage, the more their composite score and projected points are penalised.",
    category: "visual",
  },
  {
    key: "inSquadBadge",
    name: "In Squad Badge",
    short: "Green 'IN SQUAD' badge marks players already in your team.",
    long: "When viewing 'All Players' on the Recommendations or Captaincy tabs, a green 'IN SQUAD' badge appears next to players who are already in your current FPL squad. This helps you spot which top-rated players you already own vs which ones you would need to transfer in.",
    category: "visual",
  },
  {
    key: "scoreComparisonColors",
    name: "Score Comparison Colors",
    short: "Green = wildcard squad is better, red = worse, white = same.",
    long: "In the Wildcard Planner's score comparison section, the wildcard squad's scores are colored to show whether your planned squad is an improvement. Green means the wildcard squad scores higher than your current squad. Red means it scores lower. White/neutral means they are equal. The difference is shown in parentheses (e.g., '+12.3').",
    category: "visual",
  },

  // -----------------------------------------------------------------------
  // Fixture-related
  // -----------------------------------------------------------------------
  {
    key: "fdr",
    name: "FDR (Fixture Difficulty Rating)",
    short: "FPL's 1-5 scale of how hard an upcoming match is.",
    long: "A rating from 1 (easiest) to 5 (hardest) assigned by FPL to each fixture. FDR 1-2 means you are playing a weaker team (good for points). FDR 3 is neutral. FDR 4-5 means a tough opponent (harder to score/keep clean sheets). FDR feeds into both the composite score's fixture difficulty component and the projection's fixture multiplier.",
    category: "raw",
  },
  {
    key: "next5Fixtures",
    name: "Next 5 Fixtures",
    short: "Upcoming 5 opponents with difficulty color coding.",
    long: "A strip of the player's next 5 opponents, each colored by FDR. Home fixtures show the opponent in uppercase (e.g., 'BOU'), away fixtures in lowercase ('ars'). This gives you a quick visual read on whether a player has a favourable or difficult run of games ahead. A line of green blocks is a great sign for transferring a player in.",
    category: "raw",
  },
  {
    key: "ppdu",
    name: "PPDU (Points Per Difficulty Unit)",
    short: "Team PL points divided by average FDR of completed fixtures.",
    long: "PPDU adjusts the Premier League standings by fixture difficulty. It divides a team's league points by the average FDR of their completed fixtures. A team with 15 points from hard fixtures (average FDR 3.5) gets a PPDU of 4.29, while 15 points from easy fixtures (average FDR 2.0) gives only 7.50. Higher PPDU means better performance relative to the difficulty faced. This is a contextual metric only and does not affect composite scoring or player projections.",
    category: "team",
  },

  // -----------------------------------------------------------------------
  // Wildcard-specific
  // -----------------------------------------------------------------------
  {
    key: "budget",
    name: "Budget",
    short: "Total money available: squad value + bank.",
    long: "Your total FPL budget is the sum of your current squad's selling value plus the money in your bank. On a wildcard, all 15 players are sold at full current price (no selling-price penalty), so your budget equals the full squad value + bank. The budget bar and remaining amount help you track spending as you build your wildcard squad.",
    category: "controls",
  },
  {
    key: "positionLimits",
    name: "Position Limits",
    short: "FPL rules: 2 GKP, 5 DEF, 5 MID, 3 FWD in a 15-player squad.",
    long: "Every FPL squad must contain exactly 2 goalkeepers, 5 defenders, 5 midfielders, and 3 forwards (15 total). Additionally, you cannot have more than 3 players from the same Premier League team. The Wildcard Planner enforces these rules and shows validation errors if you exceed any limit.",
    category: "controls",
  },
  {
    key: "bestXI",
    name: "Best Starting XI",
    short: "The highest-scoring 11-player lineup from all valid formations.",
    long: "When your wildcard squad has 15 players, the app tests all 7 valid FPL formations (3-4-3, 3-5-2, 4-4-2, 4-3-3, 4-5-1, 5-4-1, 5-3-2) and picks the formation whose starting XI has the highest total composite score. The remaining 4 players become the bench, ordered by composite score (first sub = highest scorer). The 'XI Score' is the sum of the 11 starters' composite scores.",
    category: "scoring",
  },
  {
    key: "xiScore",
    name: "XI Score",
    short: "Sum of composite scores for the best starting 11.",
    long: "The total composite score of your best starting XI. This number lets you compare your current squad's strength to your planned wildcard squad at a glance. A higher XI score generally means a stronger lineup, though it does not account for projected points or upcoming fixtures directly (those are captured in the projected points comparison below it).",
    category: "scoring",
  },

  // -----------------------------------------------------------------------
  // Injury and opportunity adjustments
  // -----------------------------------------------------------------------
  {
    key: "injuryPenalty",
    name: "Injury Penalty",
    short: "Reduces composite score when a player is doubtful or injured.",
    long: "A multiplier applied to the composite score based on availability. Fully fit (100%) = 1.0x (no penalty). The curve is steeper than linear (power of 1.5): 75% available gives roughly 0.65x, 50% gives about 0.35x, 25% gives about 0.12x, and 0% gives 0.05x (near-zero but not invisible). This aggressive curve reflects that a doubtful player is much worse than 'half as good' since they might score zero.",
    category: "scoring",
  },
  {
    key: "opportunityBonus",
    name: "Opportunity Bonus",
    short: "Small boost for bench players whose positional rival is injured.",
    long: "If a player has low minutes but is marked 'Available', and a teammate in the same position is injured or doubtful, the player gets up to a 1.25x boost (25% increase) to their composite score. This rewards players who are about to get a run of starts due to a teammate's absence. The bonus is capped at 25% to avoid over-weighting this uncertain signal.",
    category: "scoring",
  },

  // -----------------------------------------------------------------------
  // Accuracy Tracker metrics
  // -----------------------------------------------------------------------
  {
    key: "mae",
    name: "Mean Absolute Error (MAE)",
    short: "Average difference between projected per-game points and actual GW points.",
    long: "MAE measures prediction accuracy by averaging the absolute difference between our projected per-game points and each player's actual GW points. Lower is better. An MAE of 2.0 means our projections are off by 2 points on average. Since FPL points are volatile (a hat-trick or red card can swing a score by 10+), an MAE under 3.0 is generally strong for single-gameweek predictions.",
    category: "accuracy",
  },
  {
    key: "spearmanCorrelation",
    name: "Spearman Rank Correlation",
    short: "How well our predicted player rankings match the actual results ranking.",
    long: "Spearman rank correlation measures whether our ranking order agrees with the actual points order, regardless of exact point values. It ranges from -1 to +1: 1.0 means perfect agreement (our #1 pick scored the most, #2 scored second-most, etc.), 0 means no relationship (random), and negative means inverted (our top picks scored worst). We compute this separately for composite score, blend score, and projected points to see which metric ranks players most accurately. A correlation above 0.3 is meaningful; above 0.5 is strong.",
    category: "accuracy",
  },
  {
    key: "top10HitRate",
    name: "Top-10 Hit Rate",
    short: "How many of our 10 highest-rated players actually finished in the GW's top 10.",
    long: "Of the 10 players we rated highest by blend score before the gameweek, this counts how many actually ended up in the top 10 scorers that gameweek. Shown as X/10. This is a practical measure of whether our top picks deliver. Hitting 3-4 out of 10 is decent given FPL's inherent randomness (bonus points, penalty saves, own goals). Consistently hitting 5+ suggests the model is capturing real signal.",
    category: "accuracy",
  },
  {
    key: "errorColor",
    name: "Error Color Coding",
    short: "Green = within 1 pt, amber = within 3 pts, red = 3+ pts off.",
    long: "The color of each player's error value in the accuracy table indicates how close the prediction was. Green (within 1 point) means the projection was essentially spot-on. Amber (within 3 points) means it was in the right ballpark. Red (3+ points off) means a significant miss. Large errors often come from unpredictable events like hat-tricks, red cards, or penalty saves rather than a flaw in the model.",
    category: "accuracy",
  },
  {
    key: "sampleSize",
    name: "Sample Size",
    short: "Number of players included in accuracy calculations (those with minutes played).",
    long: "Only players who actually played minutes in the selected gameweek are included in accuracy calculations. Players who were benched, injured, or otherwise absent are excluded since comparing a projection against zero minutes would be misleading. A larger sample size (typically 200-300 players per GW) makes the accuracy metrics more reliable.",
    category: "accuracy",
  },
  {
    key: "whoWeMissed",
    name: "Who We Missed",
    short: "High scorers (8+ pts) not in your squad, with their blend score for context.",
    long: "This section shows players who scored 8 or more actual FPL points in the gameweek but were not in your squad. Each player's blend score is shown alongside their actual points so you can see whether the model rated them highly (a near-miss) or low (a genuine blind spot). Players who score 8+ points represent significant hauls, roughly the top 5-10% of performers in any given gameweek. Seeing your blend score next to their actual output helps identify whether transfers targeting these players would have been supported by the model's own recommendations.",
    category: "accuracy",
  },

  // -----------------------------------------------------------------------
  // Scoring -- composite tiers and position efficiency (Oct 16 session)
  // -----------------------------------------------------------------------
  {
    key: "compositeTier",
    name: "Composite Tier",
    short: "Quartile band within position group (Elite/Strong/Average/Weak)",
    long: "Shows which band a player's composite score falls in within their position group. Elite (70+): top ~10%, historically averaged 5+ actual points per GW. Strong (50-69): top ~25%, averaged 3.6-5.0 points. Average (30-49): middle band. Weak (below 30): bottom half, averaged under 1 point in GW6 calibration. The tiers separate well at the extremes but are less predictive in the middle range, especially for MIDs.",
    category: "scoring",
  },
  {
    key: "positionEfficiency",
    name: "Position Efficiency",
    short: "Expected actual points per composite score unit, by position",
    long: "How efficiently each position converts composite score into actual FPL points. From GW6 calibration: MID 0.090 (best), FWD 0.067, GKP 0.048, DEF 0.041 (worst). This means a MID rated 40 on composite produces roughly the same actual output as a DEF rated 80. The gap exists because FPL's scoring system rewards midfield involvement (goals + assists + clean sheet points + bonus) more than the composite model accounts for. Shown as '~X.X exp pts' on each PlayerCard. Will be recalibrated as more gameweeks are played.",
    category: "scoring",
  },

  // -----------------------------------------------------------------------
  // Planning -- formation selector
  // -----------------------------------------------------------------------
  {
    key: "formationSelector",
    name: "Formation",
    short: "Lock the Best XI to a specific formation or let it auto-select",
    long: "Available on both Best GW and Wildcard pages. 'Auto (best)' tests all 7 valid FPL formations (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1) and picks the one with the highest total score. Selecting a specific formation constrains the XI to exactly that shape. Useful when you prefer to play a certain system regardless of what the optimizer suggests.",
    category: "planning",
  },

  // -----------------------------------------------------------------------
  // Squad -- auto-subs and GW transfers
  // -----------------------------------------------------------------------
  {
    key: "autoSubs",
    name: "Auto-Subs",
    short: "Automatic substitutions applied by FPL after a GW finishes",
    long: "When a starting player (positions 1-11) doesn't play at all in a gameweek, FPL automatically substitutes in the highest-priority eligible bench player. The Dashboard shows these swaps and reflects the post-substitution lineup. Auto-subs only appear after all matches in the gameweek have been processed.",
    category: "squad",
  },
  {
    key: "gwTransfers",
    name: "GW Transfers",
    short: "Players transferred in and out for the current gameweek",
    long: "Shows which transfers the manager made for the current gameweek, including player in, player out, their prices, and any point hits taken (e.g. -4 for an extra transfer). Displayed on the Dashboard above the squad grid.",
    category: "squad",
  },

  // -----------------------------------------------------------------------
  // Fixtures -- FDR color scale
  // -----------------------------------------------------------------------
  {
    key: "fdrScale",
    name: "FDR Color Scale",
    short: "Fixture Difficulty Rating 1-5, color-coded to match the official FPL website",
    long: "1 = dark green (very easy), 2 = bright green (easy), 3 = grey (medium), 4 = orange (tough), 5 = dark red (very hard). Used throughout the app: fixture grid, PlayerCard fixture mini-row, and PPDU average FDR badges. The scale matches the official FPL website's Fixture Difficulty Rating colors.",
    category: "fixtures",
  },

  // -----------------------------------------------------------------------
  // Team -- PPDU export
  // -----------------------------------------------------------------------
  {
    key: "ppduExport",
    name: "PPDU Export",
    short: "Download PPDU standings as CSV or JSON for external analysis",
    long: "Available on the PPDU Standings tab of the Fixtures page. CSV export includes rank, team name, P/W/D/L, PL points, average FDR, PPDU value, and the individual FDR of each completed fixture. JSON export wraps the same data in an envelope with export timestamp. Useful for running your own analysis in a spreadsheet or script.",
    category: "team",
  },
];

/**
 * Quick lookup by key. Returns the full definition object,
 * or a fallback with the key as the name if not found.
 *
 * @param {string} key - The metric key to look up
 * @returns {Object} - { key, name, short, long, category }
 */
export function getMetric(key) {
  return METRIC_DEFINITIONS.find((m) => m.key === key) || {
    key,
    name: key,
    short: "",
    long: "",
    category: "raw",
  };
}

/**
 * Get all metrics for a given category.
 *
 * @param {string} category - One of: dashboard, raw, derived, scoring, projection, controls, planning, squad, visual, fixtures, team, accuracy
 * @returns {Array} - Array of definition objects in that category
 */
export function getMetricsByCategory(category) {
  return METRIC_DEFINITIONS.filter((m) => m.category === category);
}

/**
 * Category display metadata: label and description for the glossary.
 */
export const CATEGORY_INFO = {
  dashboard: {
    label: "Team Summary",
    description: "Stats shown in the summary bar at the top of your squad page.",
  },
  raw: {
    label: "Player Stats",
    description: "Stats pulled from the FPL API, covering performance, expected stats, and fixture data.",
  },
  derived: {
    label: "Per-90 and Derived Stats",
    description: "Stats calculated from raw data by normalising for playing time.",
  },
  scoring: {
    label: "Scoring Metrics",
    description: "The composite, projected, blend, and captaincy scores that drive recommendations.",
  },
  projection: {
    label: "Projection System",
    description: "The components that go into calculating projected FPL points.",
  },
  controls: {
    label: "Controls and Filters",
    description: "Settings that affect how players are ranked and filtered in the app.",
  },
  visual: {
    label: "Visual Conventions",
    description: "Color systems and badges used throughout the app to convey information at a glance.",
  },
  accuracy: {
    label: "Accuracy Tracker",
    description: "Metrics used to measure how well the app's predictions matched actual FPL results.",
  },
  team: {
    label: "Team Metrics",
    description: "Team-level contextual metrics like PPDU and data exports.",
  },
  squad: {
    label: "Squad Management",
    description: "Features related to managing your squad: auto-subs, transfers, and lineup changes.",
  },
  planning: {
    label: "Planning Tools",
    description: "Tools for planning your squad: formation selection, wildcard optimization.",
  },
  fixtures: {
    label: "Fixture Systems",
    description: "Fixture difficulty color systems and conventions used throughout the app.",
  },
};

/**
 * Ordered list of categories for consistent glossary rendering.
 */
export const CATEGORY_ORDER = [
  "dashboard",
  "raw",
  "derived",
  "scoring",
  "projection",
  "controls",
  "planning",
  "squad",
  "visual",
  "fixtures",
  "team",
  "accuracy",
];

export default METRIC_DEFINITIONS;
