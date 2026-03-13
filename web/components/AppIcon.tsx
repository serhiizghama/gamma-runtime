import React from "react";

interface AppIconProps {
  icon: string;
  label: string;
  variant?: "dock" | "launchpad";
  onClick: () => void;
  title?: string;
}

/**
 * AppIcon — shared atom for Dock and Launchpad.
 *
 * Hover behavior: glyph floats up 8px with spring bounce-back curve,
 * a "shadow shelf" appears beneath it via ::after pseudo-element.
 * No square colored container — glyph only on the glass surface.
 */
export function AppIcon({
  icon,
  label,
  variant = "dock",
  onClick,
  title,
}: AppIconProps): React.ReactElement {
  const glyphSize = variant === "launchpad" ? 52 : 34;

  return (
    <button
      className={`app-icon app-icon--${variant}`}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <span
        className="app-icon__glyph"
        style={{ fontSize: glyphSize }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="app-icon__label">{label}</span>
    </button>
  );
}
