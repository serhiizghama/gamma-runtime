import React, { useEffect, useRef, useState } from "react";

const BOOT_DURATION  = 4000; // ms total boot sequence
const EXIT_DELAY     = 400;  // ms pause at 100% before fading
const EXIT_DURATION  = 900;  // ms fade-out to desktop

// ── Mini network canvas ───────────────────────────────────────────
function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const CX = canvas.width  / 2;
    const CY = canvas.height / 2;

    // Generate nodes spread across the full screen
    const nodes: { x: number; y: number; vx: number; vy: number; r: number; alpha: number }[] = [];
    // Core cluster around center
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * Math.min(canvas.width, canvas.height) * 0.45;
      nodes.push({
        x: CX + Math.cos(angle) * dist,
        y: CY + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1.5 + Math.random() * 2.5,
        alpha: 0.5 + Math.random() * 0.5,
      });
    }
    // Scatter nodes across entire screen (corners + edges)
    for (let i = 0; i < 100; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: 0.8 + Math.random() * 1.8,
        alpha: 0.2 + Math.random() * 0.5,
      });
    }

    let rafId: number;
    let startTs = 0;

    const draw = (ts: number) => {
      if (!startTs) startTs = ts;
      const elapsed = ts - startTs;
      const progress = Math.min(elapsed / BOOT_DURATION, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const globalAlpha = Math.min(progress * 4, 1);

      // Move nodes — free drift, bounce off edges, NO center gravity
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        // Soft bounce off edges
        if (n.x < 0)              { n.x = 0;              n.vx = Math.abs(n.vx); }
        if (n.x > canvas.width)   { n.x = canvas.width;   n.vx = -Math.abs(n.vx); }
        if (n.y < 0)              { n.y = 0;              n.vy = Math.abs(n.vy); }
        if (n.y > canvas.height)  { n.y = canvas.height;  n.vy = -Math.abs(n.vy); }
      }

      // Draw connections between nearby nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx   = nodes[i].x - nodes[j].x;
          const dy   = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            const a = (1 - dist / 140) * 0.30 * globalAlpha;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(0, 180, 255, ${a})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 200, 255, ${n.alpha * globalAlpha})`;
        ctx.fill();
      }

      if (elapsed < BOOT_DURATION + 500) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}

// ── Side data widget ──────────────────────────────────────────────
function DataWidget({ side, progress }: { side: "left" | "right"; progress: number }) {
  const bars = [0.72, 0.45, 0.88, 0.61, 0.93, 0.38, 0.77];
  const values = [668, 717, 484, 821, 553, 392, 729];

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        [side]: "4%",
        transform: "translateY(-50%)",
        opacity: Math.min((progress - 0.2) * 3, 1),
        width: 140,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Bar chart */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 60 }}>
        {bars.map((h, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div
              style={{
                width: "100%",
                height: `${h * 52 * Math.min(progress * 2, 1)}px`,
                background: `rgba(0, 180, 255, ${0.4 + h * 0.5})`,
                border: "1px solid rgba(0, 200, 255, 0.4)",
                borderRadius: 2,
                boxShadow: `0 0 6px rgba(0,180,255,0.3)`,
                transition: "height 0.5s ease",
              }}
            />
          </div>
        ))}
      </div>

      {/* Line graph dots */}
      <div
        style={{
          height: 30,
          border: "1px solid rgba(0,180,255,0.2)",
          borderRadius: 4,
          padding: 4,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <svg width="100%" height="100%" viewBox="0 0 100 22">
          <polyline
            points={bars.map((h, i) => `${i * 16},${22 - h * 20}`).join(" ")}
            fill="none"
            stroke="rgba(0,200,255,0.7)"
            strokeWidth="1.5"
          />
          {bars.map((h, i) => (
            <circle key={i} cx={i * 16} cy={22 - h * 20} r="2" fill="rgba(0,220,255,0.9)" />
          ))}
        </svg>
      </div>

      {/* Counters */}
      {values.slice(0, 3).map((v, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "rgba(0,180,255,0.6)", letterSpacing: "0.05em" }}>
            {["CPU", "MEM", "NET"][i]}
          </div>
          <div style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(0,220,255,0.9)", fontWeight: 700 }}>
            {Math.floor(v * Math.min(progress * 2, 1))}
          </div>
        </div>
      ))}

      {/* Circular meter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="36" height="36" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(0,80,120,0.4)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14"
            fill="none"
            stroke="rgba(0,200,255,0.85)"
            strokeWidth="3"
            strokeDasharray={`${88 * progress * 0.68} 88`}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
          />
          <text x="18" y="22" textAnchor="middle" fontSize="8" fill="rgba(0,220,255,0.9)" fontFamily="monospace">
            {Math.floor(68 * Math.min(progress * 2, 1))}%
          </text>
        </svg>
        <div style={{ fontSize: 9, color: "rgba(0,160,200,0.7)", lineHeight: 1.4 }}>
          SYS<br/>INIT
        </div>
      </div>
    </div>
  );
}

// ── Glitch text ───────────────────────────────────────────────────
function GlitchText({ children }: { children: string }) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Glitch layers */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          color: "#00ffff",
          clipPath: "inset(20% 0 60% 0)",
          transform: "translateX(-3px)",
          opacity: 0.7,
          animation: "glitch1 2.4s infinite",
        }}
      >
        {children}
      </span>
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          color: "#0040ff",
          clipPath: "inset(60% 0 10% 0)",
          transform: "translateX(3px)",
          opacity: 0.7,
          animation: "glitch2 2.7s infinite",
        }}
      >
        {children}
      </span>
      {/* Main text */}
      <span style={{ position: "relative" }}>{children}</span>
    </div>
  );
}

// ── Boot Screen ───────────────────────────────────────────────────
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress]     = useState(0);
  const [exiting, setExiting]       = useState(false);
  const [exitOpacity, setExitOpacity] = useState(1);
  const [statusLine, setStatusLine] = useState("Initializing kernel...");

  const STATUS_LINES = [
    "Initializing kernel...",
    "Loading system modules...",
    "Mounting virtual filesystem...",
    "Starting window compositor...",
    "Launching application runtime...",
    "Gamma OS ready.",
  ];

  useEffect(() => {
    let frame = 0;
    const start = performance.now();

    const tick = (ts: number) => {
      const elapsed = ts - start;
      const p = Math.min(elapsed / BOOT_DURATION, 1);
      setProgress(p);

      // Update status line
      const lineIdx = Math.floor(p * (STATUS_LINES.length - 1));
      setStatusLine(STATUS_LINES[lineIdx]);

      if (p < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        // Pause briefly at 100%, then smoothly fade out
        setTimeout(() => {
          setExiting(true);
          // Animate opacity from 1 → 0 over EXIT_DURATION
          const fadeStart = performance.now();
          const fadeStep = (now: number) => {
            const t = Math.min((now - fadeStart) / EXIT_DURATION, 1);
            setExitOpacity(1 - t);
            if (t < 1) requestAnimationFrame(fadeStep);
            else onDone();
          };
          requestAnimationFrame(fadeStep);
        }, EXIT_DELAY);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000a0f",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: exiting ? exitOpacity : 1,
      }}
    >
      {/* Network particle canvas */}
      <NetworkCanvas />

      {/* Center content */}
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
        {/* Logo */}
        <div
          style={{
            fontSize: "clamp(42px, 7vw, 88px)",
            fontWeight: 900,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            color: "#00b4ff",
            textShadow: "0 0 30px rgba(0,180,255,0.8), 0 0 60px rgba(0,100,255,0.4)",
            animation: "bootPulse 2s ease-in-out infinite",
          }}
        >
          <GlitchText>Gamma OS</GlitchText>
        </div>

        {/* Loading bar */}
        <div style={{ width: "clamp(260px, 35vw, 480px)", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Bar frame */}
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

          {/* Status line + percentage */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
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

        {/* Version tag */}
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
