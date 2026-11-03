/**
 * Tooltip.jsx -- Lightweight hover tooltip using pure CSS
 *
 * Wraps any inline content (typically a metric label or header)
 * and shows a short explanation on hover. No external library needed.
 *
 * Usage:
 *   <Tooltip text="Average points per game over the last 4 GWs.">
 *     Form
 *   </Tooltip>
 *
 * The tooltip appears above the element by default. On narrow screens
 * it may overflow, so we use a max-width and allow wrapping.
 *
 * Props:
 *   text     (string)  - The tooltip content to show on hover
 *   children (node)    - The element that triggers the tooltip
 *   position (string)  - "top" (default) or "bottom"
 */

export default function Tooltip({ text, children, position = "top" }) {
  // If no tooltip text is provided, just render children as-is
  if (!text) return <>{children}</>;

  const isBottom = position === "bottom";

  return (
    <span className="fpl-tooltip-wrap">
      {children}
      <span
        className="fpl-tooltip-bubble"
        style={{
          // Position the bubble above or below the trigger element
          ...(isBottom
            ? { top: "100%", bottom: "auto", marginTop: "6px" }
            : { bottom: "100%", top: "auto", marginBottom: "6px" }),
        }}
      >
        {text}
      </span>

      {/*
        Inline <style> scoped to this component's class names.
        This avoids needing a separate CSS file or Tailwind @apply.
        The styles are deduped by the browser when multiple Tooltips render.
      */}
      <style>{`
        .fpl-tooltip-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          cursor: help;
        }
        .fpl-tooltip-bubble {
          /* Hidden by default */
          visibility: hidden;
          opacity: 0;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          /* Styling */
          background-color: #1a1a2e;
          color: #d1d5db;
          font-size: 11px;
          font-weight: 400;
          line-height: 1.4;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid #333;
          white-space: normal;
          max-width: 260px;
          min-width: 140px;
          width: max-content;
          text-align: left;
          z-index: 50;
          pointer-events: none;
          /* Smooth fade */
          transition: opacity 0.15s ease, visibility 0.15s ease;
          /* Subtle shadow for depth */
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .fpl-tooltip-wrap:hover .fpl-tooltip-bubble {
          visibility: visible;
          opacity: 1;
        }
      `}</style>
    </span>
  );
}
