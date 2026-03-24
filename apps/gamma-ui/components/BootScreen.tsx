import { useEffect, useRef, useState } from "react";

const BOOT_DURATION = 2000;
const EXIT_DELAY    = 200;
const EXIT_DURATION = 450;

// ── Static network SVG — zero rAF, zero GPU compute ──────────────
// Pre-generated node positions + edges (deterministic, no animation)
const NODES: [number, number, number][] = [ // [x%, y%, radius]
  [12,8,2],[25,5,1.5],[40,3,1.8],[58,7,2],[75,4,1.6],[88,9,1.4],
  [6,20,1.8],[18,18,2.2],[32,15,1.5],[48,12,2],[62,18,1.7],[78,14,2.1],[92,20,1.3],
  [10,32,1.6],[22,28,2],[38,25,1.4],[50,22,2.4],[65,30,1.8],[80,26,1.5],[95,33,1.7],
  [5,45,2],[15,40,1.5],[28,38,2.2],[42,35,1.6],[55,42,2],[70,38,1.4],[85,44,1.8],
  [8,55,1.7],[20,52,2],[35,48,1.5],[50,50,2.6],[62,55,1.8],[77,50,2],[90,52,1.5],
  [12,65,1.6],[25,62,1.8],[40,58,2],[52,64,1.5],[68,60,2.2],[82,65,1.7],[94,58,1.4],
  [6,75,2],[18,72,1.5],[30,70,2],[45,74,1.8],[60,72,1.6],[75,78,2],[88,73,1.5],
  [10,85,1.4],[24,88,2],[38,82,1.7],[50,86,2.2],[65,84,1.5],[78,90,1.8],[92,85,2],
  [15,95,1.6],[35,92,1.8],[55,95,2],[72,92,1.5],[85,96,1.7],
];

// Pre-computed edges: connect nodes within ~18% distance
const EDGES: [number, number][] = [];
for (let i = 0; i < NODES.length; i++) {
  for (let j = i + 1; j < NODES.length; j++) {
    const dx = NODES[i][0] - NODES[j][0];
    const dy = NODES[i][1] - NODES[j][1];
    if (Math.sqrt(dx * dx + dy * dy) < 18) {
      EDGES.push([i, j]);
    }
  }
}

function NetworkSVG() {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.6 }}
    >
      {EDGES.map(([i, j], idx) => (
        <line
          key={idx}
          x1={NODES[i][0]} y1={NODES[i][1]}
          x2={NODES[j][0]} y2={NODES[j][1]}
          stroke="rgba(0,180,255,0.2)"
          strokeWidth="0.15"
        />
      ))}
      {NODES.map(([x, y, r], idx) => (
        <circle
          key={idx}
          cx={x} cy={y} r={r * 0.18}
          fill="rgba(0,200,255,0.5)"
        />
      ))}
    </svg>
  );
}

// ── Boot Screen ───────────────────────────────────────────────────
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress]       = useState(0);
  const [exiting, setExiting]         = useState(false);
  const [exitOpacity, setExitOpacity] = useState(1);
  const [statusLine, setStatusLine]   = useState("Initializing kernel...");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const STATUS_LINES = [
    "Initializing kernel...",
    "Loading system modules...",
    "Mounting virtual filesystem...",
    "Starting window compositor...",
    "Launching application runtime...",
    "Gamma Agent Runtime ready.",
  ];

  useEffect(() => {
    let frame = 0;
    const start = performance.now();

    const tick = (ts: number) => {
      const elapsed = ts - start;
      const p = Math.min(elapsed / BOOT_DURATION, 1);
      setProgress(p);

      const lineIdx = Math.floor(p * (STATUS_LINES.length - 1));
      setStatusLine(STATUS_LINES[lineIdx]);

      if (p < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          setExiting(true);
          const fadeStart = performance.now();
          const fadeStep = (now: number) => {
            const t = Math.min((now - fadeStart) / EXIT_DURATION, 1);
            setExitOpacity(1 - t);
            if (t < 1) requestAnimationFrame(fadeStep);
            else onDoneRef.current();
          };
          requestAnimationFrame(fadeStep);
        }, EXIT_DELAY);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--color-bg-base)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: exiting ? exitOpacity : 1,
      }}
    >
      <NetworkSVG />

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div
          style={{
            fontSize: "clamp(42px, 7vw, 88px)",
            fontWeight: 900,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            color: "var(--color-accent-primary)",
          }}
        >
          Gamma
        </div>

        <div style={{ width: "clamp(260px, 35vw, 480px)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              width: "100%",
              height: 6,
              background: "rgba(0,80,120,0.35)",
              border: "1px solid rgba(0,160,220,0.3)",
              borderRadius: 3,
              overflow: "hidden",
              boxShadow: "0 0 12px rgba(0,120,200,0.2)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: "linear-gradient(90deg, #0060c0, #00c4ff, #80e8ff)",
                borderRadius: 3,
                boxShadow: "0 0 16px rgba(0,196,255,0.8), 0 0 4px #fff",
                transition: "width 80ms linear",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                color: "rgba(0,180,255,0.7)",
                fontFamily: "monospace",
                letterSpacing: "0.05em",
              }}
            >
              {statusLine}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "rgba(0,200,255,0.9)",
                fontWeight: 700,
              }}
            >
              {Math.floor(progress * 100)}%
            </span>
          </div>
        </div>

        <div
          style={{
            fontSize: 10,
            color: "rgba(0,140,200,0.45)",
            letterSpacing: "0.1em",
            fontFamily: "monospace",
            marginTop: -10,
          }}
        >
          v1.0.0 · BUILD 2026.03
        </div>
      </div>
    </div>
  );
}
