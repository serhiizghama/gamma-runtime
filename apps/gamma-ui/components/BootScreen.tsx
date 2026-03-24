import { useEffect, useRef, useState } from "react";

const BOOT_DURATION = 1000;
const EXIT_DELAY    = 100;
const EXIT_DURATION = 250;

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
      {/* Grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.035,
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Corner brackets — top-left */}
      <svg style={{ position: "absolute", top: 32, left: 32, opacity: 0.12 }} width="40" height="40" viewBox="0 0 40 40">
        <path d="M0 12 L0 0 L12 0" fill="none" stroke="#6366f1" strokeWidth="1.5" />
      </svg>
      {/* Corner brackets — top-right */}
      <svg style={{ position: "absolute", top: 32, right: 32, opacity: 0.12 }} width="40" height="40" viewBox="0 0 40 40">
        <path d="M28 0 L40 0 L40 12" fill="none" stroke="#6366f1" strokeWidth="1.5" />
      </svg>
      {/* Corner brackets — bottom-left */}
      <svg style={{ position: "absolute", bottom: 32, left: 32, opacity: 0.12 }} width="40" height="40" viewBox="0 0 40 40">
        <path d="M0 28 L0 40 L12 40" fill="none" stroke="#6366f1" strokeWidth="1.5" />
      </svg>
      {/* Corner brackets — bottom-right */}
      <svg style={{ position: "absolute", bottom: 32, right: 32, opacity: 0.12 }} width="40" height="40" viewBox="0 0 40 40">
        <path d="M28 40 L40 40 L40 28" fill="none" stroke="#6366f1" strokeWidth="1.5" />
      </svg>

      {/* Horizontal scan lines */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.12) 20%, rgba(99, 102, 241, 0.12) 80%, transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "62%",
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.08) 25%, rgba(99, 102, 241, 0.08) 75%, transparent)",
        }}
      />

      {/* Vertical accent lines */}
      <div
        style={{
          position: "absolute",
          left: "30%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "linear-gradient(180deg, transparent, rgba(99, 102, 241, 0.06) 30%, rgba(99, 102, 241, 0.06) 70%, transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "70%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "linear-gradient(180deg, transparent, rgba(99, 102, 241, 0.06) 30%, rgba(99, 102, 241, 0.06) 70%, transparent)",
        }}
      />

      {/* Small floating data markers — left side */}
      <div style={{ position: "absolute", top: "25%", left: 48, display: "flex", alignItems: "center", gap: 6, opacity: 0.18 }}>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#6366f1" }} />
        <span style={{ fontSize: 8, fontFamily: "'SF Mono', monospace", color: "#6366f1", letterSpacing: "0.1em" }}>SYS.KERNEL</span>
      </div>
      <div style={{ position: "absolute", top: "35%", left: 48, display: "flex", alignItems: "center", gap: 6, opacity: 0.12 }}>
        <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#8b5cf6" }} />
        <span style={{ fontSize: 8, fontFamily: "'SF Mono', monospace", color: "#8b5cf6", letterSpacing: "0.1em" }}>NET.SSE</span>
      </div>

      {/* Small floating data markers — right side */}
      <div style={{ position: "absolute", top: "28%", right: 48, display: "flex", alignItems: "center", gap: 6, opacity: 0.18 }}>
        <span style={{ fontSize: 8, fontFamily: "'SF Mono', monospace", color: "#6366f1", letterSpacing: "0.1em" }}>AGENT.RT</span>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#6366f1" }} />
      </div>
      <div style={{ position: "absolute", top: "38%", right: 48, display: "flex", alignItems: "center", gap: 6, opacity: 0.12 }}>
        <span style={{ fontSize: 8, fontFamily: "'SF Mono', monospace", color: "#8b5cf6", letterSpacing: "0.1em" }}>IPC.BUS</span>
        <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#8b5cf6" }} />
      </div>

      {/* Tiny hash marks along bottom */}
      <div style={{ position: "absolute", bottom: 56, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 24, opacity: 0.08 }}>
        {Array.from({ length: 15 }, (_, i) => (
          <div key={i} style={{ width: 1, height: i % 3 === 0 ? 10 : 5, background: "#6366f1" }} />
        ))}
      </div>

      {/* Center content */}
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
        {/* Gamma neural logo */}
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
          <line x1="24" y1="22" x2="56" y2="22" stroke="rgba(99, 102, 241, 0.2)" strokeWidth="0.8" />
          <line x1="34" y1="36" x2="46" y2="36" stroke="rgba(99, 102, 241, 0.2)" strokeWidth="0.8" />
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

        {/* Subtitle */}
        <div
          style={{
            fontSize: 10,
            color: "rgba(136, 136, 170, 0.5)",
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            marginTop: -16,
          }}
        >
          Agent Runtime
        </div>

        {/* Loading bar */}
        <div style={{ width: "clamp(240px, 30vw, 400px)", display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
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
                color: "rgba(136, 136, 170, 0.6)",
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

        {/* Version tag */}
        <div
          style={{
            fontSize: 9,
            color: "rgba(85, 85, 112, 0.5)",
            letterSpacing: "0.12em",
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            marginTop: 4,
          }}
        >
          v1.0.0 · BUILD 2026.03
        </div>
      </div>
    </div>
  );
}
