/**
 * ScoreBar.jsx -- Visual composite score indicator
 *
 * A horizontal bar that fills proportionally to a player's composite score.
 * Green for high scores, yellow for mid, red for low.
 * Shows the numeric score on the right.
 */

/**
 * Get the bar colour based on the score value.
 * Higher scores get greener colours.
 */
function getScoreColor(score) {
  if (score >= 70) return "#22c55e"; // green
  if (score >= 50) return "#f59e0b"; // amber
  if (score >= 30) return "#f97316"; // orange
  return "#ef4444";                  // red
}

export default function ScoreBar({ score, maxScore = 100, showLabel = true }) {
  const percentage = Math.min(100, (score / maxScore) * 100);
  const color = getScoreColor(score);

  return (
    <div className="flex items-center gap-2">
      {/* The bar container */}
      <div
        className="flex-1 h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: "#1f1f1f" }}
      >
        {/* The filled portion */}
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>
      {/* Numeric score label */}
      {showLabel && (
        <span
          className="text-xs font-semibold tabular-nums min-w-[2rem] text-right"
          style={{ color }}
        >
          {score.toFixed(1)}
        </span>
      )}
    </div>
  );
}
