/**
 * IpcEdge — Custom React Flow edge with IPC flash animation.
 *
 * Uses getSmoothStepPath for clean routing. When `data.flashing` is true,
 * renders a glowing particle that travels along the edge path.
 */

import { memo } from "react";
import {
  getSmoothStepPath,
  BaseEdge,
  type EdgeProps,
} from "@xyflow/react";

// ── Data contract ─────────────────────────────────────────────────────────

export interface IpcEdgeData extends Record<string, unknown> {
  flashing?: boolean;
  color?: string;
}

// ── Styles ────────────────────────────────────────────────────────────────

const PARTICLE_KEYFRAMES = `
@keyframes ipcParticleTravel {
  0%   { offset-distance: 0%; opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
`;

// ── Component ─────────────────────────────────────────────────────────────

function IpcEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = (data ?? {}) as IpcEdgeData;
  const flashing = edgeData.flashing ?? false;
  const color = edgeData.color ?? "var(--color-border-subtle)";

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  return (
    <>
      <style>{PARTICLE_KEYFRAMES}</style>

      {/* Base edge line */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: flashing ? "var(--color-accent-primary)" : color,
          strokeWidth: flashing ? 2.5 : 1.5,
          transition: "stroke 300ms ease, stroke-width 300ms ease",
        }}
      />

      {/* Glow overlay when flashing */}
      {flashing && (
        <path
          d={edgePath}
          fill="none"
          stroke="var(--color-accent-primary)"
          strokeWidth={6}
          strokeOpacity={0.15}
          style={{ filter: "blur(4px)", pointerEvents: "none" }}
        />
      )}

      {/* Animated particle */}
      {flashing && (
        <circle
          r={4}
          fill="var(--color-accent-primary)"
          style={{
            filter: "drop-shadow(0 0 6px var(--color-accent-primary))",
            offsetPath: `path("${edgePath}")`,
            animation: "ipcParticleTravel 1.2s ease-in-out forwards",
          } as React.CSSProperties}
        />
      )}
    </>
  );
}

export const IpcEdge = memo(IpcEdgeInner);
