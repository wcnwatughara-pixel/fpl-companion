/**
 * formatters.js -- Display formatting utilities
 *
 * Small helper functions for formatting numbers, prices, and other
 * values for display in the UI. Keeps formatting logic in one place
 * so the components stay clean.
 */

/**
 * Format a player's price for display.
 * The API stores prices as integers (e.g., 125 = $12.5m).
 * We've already divided by 10 in transforms.js, so this just
 * ensures one decimal place.
 *
 * @param {number} price - Price in millions (e.g., 12.5)
 * @returns {string} - Formatted price (e.g., "12.5")
 */
export function formatPrice(price) {
  return price.toFixed(1);
}

/**
 * Format a large number with commas for readability.
 * Used for things like overall rank (e.g., 1234567 -> "1,234,567").
 *
 * @param {number} num - The number to format
 * @returns {string} - Formatted number string
 */
export function formatNumber(num) {
  if (num == null) return "-";
  return num.toLocaleString();
}

/**
 * Format a decimal number to one decimal place.
 * Used for scores, per-90 stats, etc.
 *
 * @param {number} num - The number to format
 * @returns {string} - Formatted number (e.g., "4.3")
 */
export function formatDecimal(num) {
  if (num == null || isNaN(num)) return "-";
  return num.toFixed(1);
}

/**
 * Format a percentage for display.
 *
 * @param {number} num - The percentage value
 * @returns {string} - Formatted percentage (e.g., "23.4%")
 */
export function formatPercent(num) {
  if (num == null || isNaN(num)) return "-";
  return `${num.toFixed(1)}%`;
}

/**
 * Get a human-readable label for a player's availability status.
 * The API uses single-letter codes.
 *
 * @param {string} status - Status code from the API
 * @returns {{ label: string, color: string }} - Display label and colour
 */
export function getStatusInfo(status) {
  switch (status) {
    case "a":
      return { label: "Available", color: "#22c55e" };    // green
    case "d":
      return { label: "Doubtful", color: "#f59e0b" };     // amber
    case "i":
      return { label: "Injured", color: "#ef4444" };      // red
    case "u":
      return { label: "Unavailable", color: "#ef4444" };  // red
    case "s":
      return { label: "Suspended", color: "#ef4444" };    // red
    case "n":
      return { label: "Not in squad", color: "#6b7280" }; // grey
    default:
      return { label: "Unknown", color: "#6b7280" };
  }
}

/**
 * Format a date string into a short, readable format.
 *
 * @param {string} isoString - ISO date string from the API
 * @returns {string} - Formatted date (e.g., "8 Oct 14:30")
 */
export function formatDate(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}
