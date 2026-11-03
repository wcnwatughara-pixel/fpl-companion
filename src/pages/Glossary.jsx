/**
 * Glossary.jsx -- Metric Glossary / Help page
 *
 * A reference page explaining every metric, score, color system, and
 * control used in the app. Organized by category with expandable entries.
 *
 * Each entry shows the metric name and short description by default.
 * Clicking an entry expands it to show the full detailed explanation.
 *
 * Categories are rendered in a fixed order defined in metricDefinitions.js.
 */

import { useState } from "react";
import {
  getMetricsByCategory,
  CATEGORY_INFO,
  CATEGORY_ORDER,
} from "../data/metricDefinitions.js";

export default function Glossary() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold mb-1">Glossary</h1>
        <p className="text-sm text-gray-400">
          Everything the app shows you, explained. Click any entry to expand
          the full description.
        </p>
      </div>

      {CATEGORY_ORDER.map((catKey) => {
        const info = CATEGORY_INFO[catKey];
        const metrics = getMetricsByCategory(catKey);
        if (!metrics.length) return null;

        return (
          <CategorySection
            key={catKey}
            label={info.label}
            description={info.description}
            metrics={metrics}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category section: heading + list of expandable metric entries
// ---------------------------------------------------------------------------

function CategorySection({ label, description, metrics }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-gray-200 mb-0.5">{label}</h2>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      <div className="space-y-1">
        {metrics.map((metric) => (
          <MetricEntry key={metric.key} metric={metric} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Single metric entry: click to expand/collapse
// ---------------------------------------------------------------------------

function MetricEntry({ metric }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg transition-colors"
      style={{
        backgroundColor: expanded ? "#111" : "transparent",
        border: expanded ? "1px solid #222" : "1px solid transparent",
      }}
    >
      {/* Clickable header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-3 group"
      >
        {/* Expand/collapse indicator */}
        <span
          className="text-gray-600 text-xs mt-0.5 shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>

        <div className="flex-1 min-w-0">
          {/* Metric name */}
          <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
            {metric.name}
          </span>
          {/* Short description (always visible) */}
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {metric.short}
          </p>
        </div>

        {/* Category pill */}
        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 mt-0.5"
          style={{
            backgroundColor: getCategoryColor(metric.category),
            color: "#000",
          }}
        >
          {getCategoryLabel(metric.category)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 ml-6">
          <p className="text-xs text-gray-300 leading-relaxed">
            {metric.long}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Short label for the category pill on each entry.
 * Keeps the pill compact while still informative.
 */
function getCategoryLabel(category) {
  const labels = {
    dashboard: "Summary",
    raw: "Stat",
    derived: "Derived",
    scoring: "Score",
    projection: "Projection",
    controls: "Control",
    visual: "Visual",
  };
  return labels[category] || category;
}

/**
 * Background color for the category pill.
 * Subtle, muted tones that work on the dark background.
 */
function getCategoryColor(category) {
  const colors = {
    dashboard: "#6b7280", // gray
    raw: "#3b82f6",       // blue
    derived: "#8b5cf6",   // purple
    scoring: "#22c55e",   // green
    projection: "#f59e0b", // amber
    controls: "#64748b",  // slate
    visual: "#ec4899",    // pink
  };
  return colors[category] || "#6b7280";
}
