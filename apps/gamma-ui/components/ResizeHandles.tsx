import React from "react";

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizeHandlesProps {
  onResizePointerDown: (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => void;
}

const EDGE_SIZE = 6;
const CORNER_SIZE = 14;

const CURSOR_MAP: Record<ResizeEdge, string> = {
  n:  "ns-resize",
  s:  "ns-resize",
  e:  "ew-resize",
  w:  "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

interface HandleStyle {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  width?: number | string;
  height?: number | string;
}

const HANDLE_STYLES: Record<ResizeEdge, HandleStyle> = {
  n:  { top: 0,    left: CORNER_SIZE, right: CORNER_SIZE,  height: EDGE_SIZE },
  s:  { bottom: 0, left: CORNER_SIZE, right: CORNER_SIZE,  height: EDGE_SIZE },
  e:  { top: CORNER_SIZE, bottom: CORNER_SIZE, right: 0,   width: EDGE_SIZE },
  w:  { top: CORNER_SIZE, bottom: CORNER_SIZE, left: 0,    width: EDGE_SIZE },
  ne: { top: 0,    right: 0,   width: CORNER_SIZE, height: CORNER_SIZE },
  nw: { top: 0,    left: 0,    width: CORNER_SIZE, height: CORNER_SIZE },
  se: { bottom: 0, right: 0,   width: CORNER_SIZE, height: CORNER_SIZE },
  sw: { bottom: 0, left: 0,    width: CORNER_SIZE, height: CORNER_SIZE },
};

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function ResizeHandles({ onResizePointerDown }: ResizeHandlesProps): React.ReactElement {
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          onPointerDown={onResizePointerDown(edge)}
          style={{
            position: "absolute",
            ...HANDLE_STYLES[edge],
            cursor: CURSOR_MAP[edge],
            zIndex: 50,
            pointerEvents: "auto",
            // Invisible — purely a hit target
            background: "transparent",
          }}
        />
      ))}
    </>
  );
}
