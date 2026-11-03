/**
 * metricDefinitions-additions.js
 *
 * New metric definitions to ADD to metricDefinitions.js.
 * Paste these into the METRICS array in metricDefinitions.js.
 *
 * These cover features added in the Oct 16 session:
 * - PPDU export
 * - Composite tier
 * - Position efficiency
 * - Formation selector
 * - Auto-subs
 * - FDR color scale
 *
 * Each entry follows the existing format:
 *   { key, name, short, long, category }
 */

// ---- Add these entries to the METRICS array in metricDefinitions.js ----

// PPDU (already added in prior session, but verify it exists)
// {
//   key: "ppdu",
//   name: "PPDU",
//   short: "Points Per Difficulty Unit",
//   long: "Team PL points divided by the average FDR of their completed fixtures. Higher = better performance relative to difficulty faced. A team earning 12 points against FDR 3.8 opposition has PPDU 3.16; the same points against FDR 2.2 gives PPDU 5.45. Useful for spotting teams that will surge when fixtures soften or drop off when they harden. Visual only; not factored into composite scoring.",
//   category: "Team",
// },

// Composite Tier
{
  key: "compositeTier",
  name: "Composite Tier",
  short: "Quartile band within position group (Elite/Strong/Average/Weak)",
  long: "Shows which band a player's composite score falls in within their position group. Elite (70+): top ~10%, historically averaged 5+ actual points per GW. Strong (50-69): top ~25%, averaged 3.6-5.0 points. Average (30-49): middle band. Weak (below 30): bottom half, averaged under 1 point in GW6 calibration. The tiers separate well at the extremes but are less predictive in the middle range, especially for MIDs.",
  category: "Scoring",
},

// Position Efficiency
{
  key: "positionEfficiency",
  name: "Position Efficiency",
  short: "Expected actual points per composite score unit, by position",
  long: "How efficiently each position converts composite score into actual FPL points. From GW6 calibration: MID 0.090 (best), FWD 0.067, GKP 0.048, DEF 0.041 (worst). This means a MID rated 40 on composite produces roughly the same actual output as a DEF rated 80. The gap exists because FPL's scoring system rewards midfield involvement (goals + assists + clean sheet points + bonus) more than the composite model accounts for. Shown as '~X.X exp pts' on each PlayerCard. Will be recalibrated as more gameweeks are played.",
  category: "Scoring",
},

// Formation Selector
{
  key: "formationSelector",
  name: "Formation",
  short: "Lock the Best XI to a specific formation or let it auto-select",
  long: "Available on both Best GW and Wildcard pages. 'Auto (best)' tests all 7 valid FPL formations (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1) and picks the one with the highest total score. Selecting a specific formation constrains the XI to exactly that shape. Useful when you prefer to play a certain system regardless of what the optimizer suggests.",
  category: "Planning",
},

// Auto-Subs
{
  key: "autoSubs",
  name: "Auto-Subs",
  short: "Automatic substitutions applied by FPL after a GW finishes",
  long: "When a starting player (positions 1-11) doesn't play at all in a gameweek, FPL automatically substitutes in the highest-priority eligible bench player. The Dashboard shows these swaps and reflects the post-substitution lineup. Auto-subs only appear after all matches in the gameweek have been processed.",
  category: "Squad",
},

// GW Transfers
{
  key: "gwTransfers",
  name: "GW Transfers",
  short: "Players transferred in and out for the current gameweek",
  long: "Shows which transfers the manager made for the current gameweek, including player in, player out, their prices, and any point hits taken (e.g. -4 for an extra transfer). Displayed on the Dashboard above the squad grid.",
  category: "Squad",
},

// FDR Color Scale
{
  key: "fdrScale",
  name: "FDR Color Scale",
  short: "Fixture Difficulty Rating 1-5, color-coded to match the official FPL website",
  long: "1 = dark green (very easy), 2 = bright green (easy), 3 = grey (medium), 4 = orange (tough), 5 = dark red (very hard). Used throughout the app: fixture grid, PlayerCard fixture mini-row, and PPDU average FDR badges. The scale matches the official FPL website's Fixture Difficulty Rating colors.",
  category: "Fixtures",
},

// PPDU Export
{
  key: "ppduExport",
  name: "PPDU Export",
  short: "Download PPDU standings as CSV or JSON for external analysis",
  long: "Available on the PPDU Standings tab of the Fixtures page. CSV export includes rank, team name, P/W/D/L, PL points, average FDR, PPDU value, and the individual FDR of each completed fixture. JSON export wraps the same data in an envelope with export timestamp. Useful for running your own analysis in a spreadsheet or script.",
  category: "Team",
},
