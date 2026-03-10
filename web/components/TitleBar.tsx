import React from "react";
import { useOSStore } from "../store/useOSStore";

interface TitleBarProps {
  windowId: string;
  title: string;
  onDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function TitleBar({ windowId, title, onDragStart }: TitleBarProps): React.ReactElement {
  const closeWindow    = useOSStore((s) => s.closeWindow);
  const minimizeWindow = useOSStore((s) => s.minimizeWindow);
  const maximizeWindow = useOSStore((s) => s.maximizeWindow);

  return (
    <div className="window-titlebar" onPointerDown={onDragStart}>
      {/* Traffic lights — stop propagation so clicks don't start drag */}
      <div
        className="window-titlebar__lights"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="btn-close"
          onClick={(e) => { e.stopPropagation(); closeWindow(windowId); }}
          aria-label="Close"
        />
        <button
          className="btn-minimize"
          onClick={(e) => { e.stopPropagation(); minimizeWindow(windowId); }}
          aria-label="Minimize"
        />
        <button
          className="btn-maximize"
          onClick={(e) => { e.stopPropagation(); maximizeWindow(windowId); }}
          aria-label="Maximize"
        />
      </div>

      <span className="window-titlebar__title">{title}</span>
      <div className="window-titlebar__spacer" />
    </div>
  );
}
