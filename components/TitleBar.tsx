import React from "react";
import { useOSStore } from "../store/useOSStore";

interface TitleBarProps {
  windowId: string;
  title: string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function TitleBar({ windowId, title, onPointerDown }: TitleBarProps): React.ReactElement {
  const closeWindow = useOSStore((s) => s.closeWindow);
  const minimizeWindow = useOSStore((s) => s.minimizeWindow);
  const maximizeWindow = useOSStore((s) => s.maximizeWindow);

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        height: "var(--window-titlebar-height)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
        flexShrink: 0,
        cursor: "grab",
        WebkitAppRegion: "drag",
        userSelect: "none",
        borderBottom: "1px solid var(--glass-border)",
      } as React.CSSProperties}
    >
      {/* Traffic lights */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onMouseDown={stopProp}>
        <button
          onClick={(e) => { e.stopPropagation(); closeWindow(windowId); }}
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--btn-close)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
          aria-label="Close"
        />
        <button
          onClick={(e) => { e.stopPropagation(); minimizeWindow(windowId); }}
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--btn-minimize)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
          aria-label="Minimize"
        />
        <button
          onClick={(e) => { e.stopPropagation(); maximizeWindow(windowId); }}
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--btn-maximize)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
          aria-label="Maximize"
        />
      </div>

      {/* Title */}
      <span
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {title}
      </span>

      {/* Spacer to balance traffic lights */}
      <div style={{ width: 42, flexShrink: 0 }} />
    </div>
  );
}
