import React from "react";
import { useOSStore } from "../store/useOSStore";

export function Desktop(): React.ReactElement {
  const launchpadOpen = useOSStore((s) => s.launchpadOpen);

  return (
    <div
      className={launchpadOpen ? "desktop--launchpad-open" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)",
        zIndex: 0,
      }}
    />
  );
}
