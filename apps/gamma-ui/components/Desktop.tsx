import React, { useEffect, useRef } from "react";
import { useOSStore } from "../store/useOSStore";

// ---------------------------------------------------------------------------
// Aurora Waves — horizontal sine-band layers + glowing crests + star field.
// Gamma colour palette. GPU-friendly, no CSS animations.
// ---------------------------------------------------------------------------

interface Wave {
  yBase: number;
  amp: number;
  freq: number;
  speed: number;
  phase: number;
  hue: number;
  sat: number;
  alpha: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;   // twinkle phase
  speed: number;   // twinkle speed
}

// fill: "up" → band closes to y=0 (top edge), "down" → closes to h (bottom edge)
type FillDir = "up" | "down";
const WAVES: (Omit<Wave, "phase"> & { dir: FillDir })[] = [
  { yBase: 0.06, amp: 40,  freq: 0.0022, speed: 0.003,  hue: 230, sat: 65, alpha: 0.10, dir: "up"   },
  { yBase: 0.18, amp: 55,  freq: 0.0016, speed: 0.0045, hue: 215, sat: 72, alpha: 0.11, dir: "up"   },
  { yBase: 0.30, amp: 60,  freq: 0.0018, speed: 0.004,  hue: 220, sat: 70, alpha: 0.10, dir: "up"   },
  { yBase: 0.45, amp: 50,  freq: 0.0024, speed: 0.006,  hue: 210, sat: 78, alpha: 0.09, dir: "down" },
  { yBase: 0.55, amp: 75,  freq: 0.0014, speed: 0.003,  hue: 235, sat: 65, alpha: 0.09, dir: "down" },
  { yBase: 0.67, amp: 55,  freq: 0.0020, speed: 0.005,  hue: 200, sat: 75, alpha: 0.10, dir: "down" },
  { yBase: 0.78, amp: 65,  freq: 0.0016, speed: 0.0035, hue: 245, sat: 60, alpha: 0.09, dir: "down" },
  { yBase: 0.90, amp: 45,  freq: 0.0019, speed: 0.004,  hue: 225, sat: 68, alpha: 0.11, dir: "down" },
];

const STAR_COUNT = 55;

function makeStars(w: number, h: number): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.4 + Math.random() * 0.9,
    phase: Math.random() * Math.PI * 2,
    speed: 0.005 + Math.random() * 0.012,
  }));
}

function useAuroraWaves(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    let stars: Star[] = [];

    const resize = () => {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width  = w;
      canvas.height = h;
      stars = makeStars(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const waves = WAVES.map((wv) => ({ ...wv, phase: Math.random() * Math.PI * 2 }));

    let rafId: number;
    let tick = 0;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, w, h);

      // ── Star field ──────────────────────────────────────────────────────
      for (const s of stars) {
        s.phase += s.speed;
        const alpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 210, 255, ${alpha.toFixed(3)})`;
        ctx.fill();
      }

      // ── Wave bands ──────────────────────────────────────────────────────
      for (const wave of waves) {
        wave.phase += wave.speed;
        const yCenter = wave.yBase * h;

        const pts: [number, number][] = [];
        for (let x = 0; x <= w; x += 3) {
          pts.push([x, yCenter + Math.sin(x * wave.freq + wave.phase) * wave.amp]);
        }

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);

        // Fill toward nearest edge
        const edgeY = wave.dir === "up" ? 0 : h;
        ctx.lineTo(w, edgeY);
        ctx.lineTo(0, edgeY);
        ctx.closePath();

        // Gradient fades away from the crest toward the edge
        const g0 = wave.dir === "up" ? yCenter + wave.amp : yCenter - wave.amp;
        const g1 = wave.dir === "up" ? 0                  : h;
        const grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0,   `hsla(${wave.hue}, ${wave.sat}%, 58%, ${wave.alpha})`);
        grad.addColorStop(0.5, `hsla(${wave.hue}, ${wave.sat}%, 50%, ${wave.alpha * 0.4})`);
        grad.addColorStop(1,   `hsla(${wave.hue}, ${wave.sat}%, 40%, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef]);
}

// ---------------------------------------------------------------------------

export function Desktop(): React.ReactElement {
  const launchpadOpen = useOSStore((s) => s.launchpadOpen);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useAuroraWaves(canvasRef);

  return (
    <div
      className={launchpadOpen ? "desktop--launchpad-open" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: "rgb(6, 8, 16)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />

      {/* Brand watermark — above waves, below windows */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 1,
          gap: "clamp(16px, 2.5vw, 40px)",
        }}
      >
        <svg
          viewBox="0 0 80 100"
          style={{ width: "clamp(36px, 6vw, 80px)", height: "auto", opacity: 0.45, flexShrink: 0 }}
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
                stroke="rgba(59, 130, 246, 0.35)"
                strokeWidth="1.2"
              />
            ))
          )}
          <line x1="24" y1="22" x2="56" y2="22" stroke="rgba(59, 130, 246, 0.15)" strokeWidth="0.8" />
          <line x1="34" y1="36" x2="46" y2="36" stroke="rgba(59, 130, 246, 0.15)" strokeWidth="0.8" />
          {[
            [14,8,2.2],[66,8,2.2],[24,22,1.6],[56,22,1.6],
            [34,36,1.4],[46,36,1.4],[40,48,2.6],[40,66,1.6],[40,88,2.0],
            [8,28,1.0],[72,28,1.0],[18,58,0.9],[54,72,0.9],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill={i === 6 ? "rgba(59,130,246,0.6)" : "rgba(96,165,250,0.35)"} />
          ))}
        </svg>

        <span
          style={{
            fontSize: "clamp(48px, 8vw, 110px)",
            fontWeight: 900,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            color: "transparent",
            WebkitTextStroke: "1px rgba(59, 130, 246, 0.20)",
            textShadow: "0 0 80px rgba(59, 130, 246, 0.10)",
            userSelect: "none",
            opacity: 0.6,
          }}
        >
          Gamma
        </span>
      </div>
    </div>
  );
}
