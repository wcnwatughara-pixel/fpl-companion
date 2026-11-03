/**
 * fdrColors.js -- Shared FDR color scale
 *
 * Central source of truth for Fixture Difficulty Rating colors.
 * Matches the official FPL website's color scheme:
 *   1 = dark green  (very easy)
 *   2 = bright green (easy)
 *   3 = grey         (medium)
 *   4 = orange        (tough)       <-- FPL uses orange, not red
 *   5 = dark red      (very hard)
 *
 * Import these helpers anywhere FDR colors are needed (fixture grid,
 * PlayerCard FixtureMiniRow, PPDU badges, etc.) so updates propagate
 * from one file.
 */

// ---------------------------------------------------------------------------
// Background color for a given FDR value
// ---------------------------------------------------------------------------

/**
 * Map FDR (1-5) to a background colour.
 * 1-2 = easy (green shades), 3 = neutral (grey),
 * 4 = tough (orange), 5 = hardest (dark red).
 *
 * @param {number} fdr - Fixture difficulty rating, 1 to 5
 * @returns {string} - Hex colour code
 */
export function fdrBg(fdr) {
  switch (fdr) {
    case 1: return "#257d5a"; // dark green -- easiest
    case 2: return "#01fc7a"; // bright green
    case 3: return "#999";    // neutral grey
    case 4: return "#e87d00"; // orange -- tough (official FPL style)
    case 5: return "#c62828"; // dark red -- hardest
    default: return "#555";
  }
}

// ---------------------------------------------------------------------------
// Text color for a given FDR value
// ---------------------------------------------------------------------------

/**
 * Choose text colour for readability on top of the FDR background.
 * Dark text on bright green (FDR 2), white text everywhere else.
 *
 * @param {number} fdr - Fixture difficulty rating, 1 to 5
 * @returns {string} - Hex colour code for text
 */
export function fdrText(fdr) {
  return fdr === 2 ? "#000" : "#fff";
}
