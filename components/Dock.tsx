import React from "react";

export function Dock(): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--dock-bg)",
        backdropFilter: "var(--dock-blur)",
        borderRadius: "var(--dock-radius)",
        padding: "var(--dock-padding)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 80,
        minHeight: 72,
        zIndex: 1000,
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--glass-shadow)",
      }}
    />
  );
}
