import React from "react";
import { useOSStore } from "../store/useOSStore";
import { WindowErrorBoundary } from "./WindowErrorBoundary";
import { WindowNode } from "./WindowNode";

export function WindowManager(): React.ReactElement {
  const windows = useOSStore((s) => s.windows);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "auto",
        zIndex: 1,
      }}
    >
      {Object.values(windows).map((win) => (
        <WindowErrorBoundary key={win.id} windowId={win.id} appId={win.appId}>
          <WindowNode id={win.id} />
        </WindowErrorBoundary>
      ))}
    </div>
  );
}
