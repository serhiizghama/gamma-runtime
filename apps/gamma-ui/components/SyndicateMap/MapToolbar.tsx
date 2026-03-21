/**
 * MapToolbar — Layout controls for the Syndicate Map canvas.
 *
 * Provides layout direction buttons, fit-view, reset, and a layout mode indicator.
 * Uses inline CSSProperties + .syndicate-toolbar-btn class for hover states
 * (defined in the parent's INJECTED_KEYFRAMES style block).
 */

import React from "react";

interface Props {
  onLayout: (direction: "TB" | "LR") => void;
  onFitView: () => void;
  onResetPositions: () => void;
  layoutMode: "auto" | "manual";
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const toolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  gap: 6,
  zIndex: 5,
};

const toolbarBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  color: "var(--color-text-secondary)",
  background: "var(--color-surface-elevated)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 6,
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 10,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  borderRadius: 6,
  alignSelf: "center",
  lineHeight: 1,
  userSelect: "none",
};

export const MapToolbar: React.FC<Props> = ({
  onLayout,
  onFitView,
  onResetPositions,
  layoutMode,
  loading,
  error,
  onRetry,
}) => {
  return (
    <div style={toolbarStyle}>
      <button
        className="syndicate-toolbar-btn"
        style={toolbarBtn}
        onClick={() => onLayout("TB")}
      >
        ↕ Vertical
      </button>
      <button
        className="syndicate-toolbar-btn"
        style={toolbarBtn}
        onClick={() => onLayout("LR")}
      >
        ↔ Horizontal
      </button>
      <button
        className="syndicate-toolbar-btn"
        style={toolbarBtn}
        onClick={onFitView}
      >
        ⊞ Fit
      </button>
      {layoutMode === "manual" && (
        <button
          className="syndicate-toolbar-btn"
          style={toolbarBtn}
          onClick={onResetPositions}
        >
          ↻ Reset
        </button>
      )}
      <span
        style={{
          ...badgeStyle,
          color:
            layoutMode === "auto"
              ? "var(--color-accent-primary, #58a6ff)"
              : "var(--color-accent-warning, #d29922)",
          background:
            layoutMode === "auto"
              ? "rgba(88, 166, 255, 0.12)"
              : "rgba(210, 153, 34, 0.12)",
          border: `1px solid ${
            layoutMode === "auto"
              ? "rgba(88, 166, 255, 0.25)"
              : "rgba(210, 153, 34, 0.25)"
          }`,
        }}
      >
        {layoutMode === "auto" ? "Auto" : "Manual"}
      </span>
      {loading && (
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            alignSelf: "center",
            marginLeft: 8,
          }}
        >
          Loading…
        </span>
      )}
      {error && !loading && (
        <span
          style={{
            fontSize: 11,
            color: "var(--color-accent-error, #ff5f57)",
            alignSelf: "center",
            marginLeft: 8,
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={onRetry}
          title="Click to retry"
        >
          ⚠ {error} — retry
        </span>
      )}
    </div>
  );
};
