import { useEffect, useRef, useState } from "react";

const BOOT_DURATION = 1000; // was 2000
const EXIT_DELAY    = 100;  // was 200
const EXIT_DURATION = 250;  // was 450

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
    "Starting window compositor...",
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
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: exiting ? exitOpacity : 1,
        background: `
          radial-gradient(ellipse 60% 60% at 50% 45%, rgba(99, 102, 241, 0.12) 0%, transparent 70%),
          radial-gradient(ellipse 45% 35% at 25% 30%, rgba(59, 130, 246, 0.08) 0%, transparent 60%),
          radial-gradient(ellipse 40% 40% at 75% 65%, rgba(139, 92, 246, 0.07) 0%, transparent 55%),
          rgb(6, 8, 16)
        `,
      }}
    >
      {/* Subtle grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.04,
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Horizontal scan line accent */}
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.15) 30%, rgba(99, 102, 241, 0.15) 70%, transparent)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        {/* Gamma logo SVG */}
        <svg
          viewBox="0 0 80 100"
          style={{ width: 56, height: "auto", opacity: 0.7, marginBottom: -8 }}
        >
          {[
            [[14, 8],  [24, 22], [34, 36], [40, 48]],
            [[66, 8],  [56, 22], [46, 36], [40, 48]],
            [[40, 48], [40, 66], [40, 88]],
          ].map((arm, ai) =>
            arm.slice(0, -1).map((pt, i) => (
              <line
                key={`${ai}-${i}`}
                x1={pt[0]} y1={pt[1]}
                x2={arm[i + 1][0]} y2={arm[i + 1][1]}
                stroke="rgba(99, 102, 241, 0.6)"
                strokeWidth="1.5"
              />
            ))
          )}
          {[
            [14,8,2.2],[66,8,2.2],[24,22,1.6],[56,22,1.6],
            [34,36,1.4],[46,36,1.4],[40,48,2.6],[40,66,1.6],[40,88,2.0],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill={i === 6 ? "rgba(99,102,241,0.8)" : "rgba(99,102,241,0.45)"} />
          ))}
        </svg>

        {/* Title */}
        <div
          style={{
            fontSize: "clamp(36px, 6vw, 72px)",
            fontWeight: 900,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            color: "#e8e8f0",
          }}
        >
          Gamma
        </div>

        {/* Loading bar */}
        <div style={{ width: "clamp(240px, 30vw, 400px)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              width: "100%",
              height: 3,
              background: "rgba(99, 102, 241, 0.15)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: "linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)",
                borderRadius: 2,
                transition: "width 60ms linear",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: 10,
                color: "rgba(136, 136, 170, 0.8)",
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                letterSpacing: "0.04em",
              }}
            >
              {statusLine}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                color: "rgba(99, 102, 241, 0.8)",
                fontWeight: 600,
              }}
            >
              {Math.floor(progress * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
