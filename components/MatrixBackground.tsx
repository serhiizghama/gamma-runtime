import { useEffect, useRef } from "react";

// ── Glyph set — Katakana + Latin + numerics + symbols ─────────────────────
const KATAKANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンヴァィゥェォ";
const LATIN    = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS   = "0123456789";
const SYMBOLS  = "@#$%&|;:=+~<>/*";
const CHARS    = (KATAKANA + LATIN + DIGITS + SYMBOLS).split("");

// ── Layer definition ───────────────────────────────────────────────────────
interface LayerDef {
  fontSize:    number;
  alpha:       number;   // max opacity for stream body
  speedMin:    number;   // cells/frame
  speedMax:    number;
  streamLenMin: number;
  streamLenMax: number;
  density:     number;   // target active-streams-per-100-cols
  glyphChangeP: number;  // probability glyph mutates per frame
}

const LAYERS: LayerDef[] = [
  // Background — dim, slow, smaller
  { fontSize: 12, alpha: 0.30, speedMin: 0.010, speedMax: 0.025, streamLenMin: 18, streamLenMax: 32, density: 90, glyphChangeP: 0.04 },
  // Midground — medium
  { fontSize: 14, alpha: 0.65, speedMin: 0.020, speedMax: 0.045, streamLenMin: 20, streamLenMax: 40, density: 95, glyphChangeP: 0.06 },
  // Foreground — bright, fast, main layer
  { fontSize: 14, alpha: 1.00, speedMin: 0.035, speedMax: 0.075, streamLenMin: 22, streamLenMax: 48, density: 95, glyphChangeP: 0.08 },
];

const TARGET_FPS = 40;
const BG_FILL    = "rgba(0, 0, 0, 0.18)";  // fade trail — lower = longer trails

// ── Stream state ───────────────────────────────────────────────────────────
interface Stream {
  col:    number;    // column index
  headY:  number;   // fractional cell position of stream head
  length: number;   // stream length in cells
  speed:  number;   // cells per frame
  glyphs: string[]; // current glyphs for each cell in stream
  active: boolean;
}

function randomChar() { return CHARS[Math.floor(Math.random() * CHARS.length)]; }
function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function createStream(col: number, def: LayerDef, rows: number): Stream {
  const length = Math.floor(rand(def.streamLenMin, def.streamLenMax));
  return {
    col,
    // Scatter initial positions across full height for instant carpet effect
    headY: rand(-length, rows + 5),
    length,
    speed: rand(def.speedMin, def.speedMax),
    glyphs: Array.from({ length }, randomChar),
    active: true,
  };
}

// ── Color helpers ─────────────────────────────────────────────────────────
// Position 0 = head, position = length-1 = tail
function glyphColor(pos: number, length: number, layerAlpha: number): string {
  const t = pos / Math.max(length - 1, 1); // 0 at head, 1 at tail

  if (pos === 0) {
    // Head: near-white
    return `rgba(220, 255, 220, ${layerAlpha})`;
  }
  if (pos <= 2) {
    // Sub-head: bright lime
    const a = layerAlpha * 0.95;
    return `rgba(57, 255, 20, ${a})`;
  }

  // Body → tail: fade from #00cc44 → #003311
  const bodyT = (t - 0.1) / 0.9; // normalized within body+tail
  const g = Math.max(20, Math.round(204 - bodyT * 184)); // 204 → 20
  const a = layerAlpha * (1 - bodyT * 0.92);
  return `rgba(0, ${g}, ${Math.round(g * 0.18)}, ${Math.max(a, 0)})`;
}

// ── Component ──────────────────────────────────────────────────────────────
export function MatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    let rafId: number;
    let last = 0;
    const frameMs = 1000 / TARGET_FPS;

    // Per-layer state: streams[layerIdx][streamIdx]
    let layerStreams: Stream[][] = [];

    const init = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      layerStreams = LAYERS.map((def) => {
        const cols = Math.floor(canvas.width / def.fontSize);
        const rows = Math.floor(canvas.height / def.fontSize) + 10;
        const streams: Stream[] = [];

        // Seed initial streams to fill canvas immediately
        for (let c = 0; c < cols; c++) {
          const numStreams = Math.random() < def.density / 100 ? 1 : 0;
          for (let s = 0; s < numStreams; s++) {
            streams.push(createStream(c, def, rows));
          }
        }
        return streams;
      });
    };

    const drawLayer = (def: LayerDef, streams: Stream[]) => {
      const rows = Math.floor(canvas.height / def.fontSize) + 10;
      const cols = Math.floor(canvas.width  / def.fontSize);

      ctx.font = `bold ${def.fontSize}px "Courier New", monospace`;

      // Mutate glyphs and advance streams
      for (const s of streams) {
        s.headY += s.speed;

        // Randomly mutate glyphs within stream
        for (let i = 0; i < s.glyphs.length; i++) {
          if (Math.random() < def.glyphChangeP) s.glyphs[i] = randomChar();
        }

        // Render stream — from head down
        for (let i = 0; i < s.length; i++) {
          const cellY = Math.floor(s.headY) - i;
          if (cellY < -1 || cellY > rows) continue;

          const x = s.col * def.fontSize;
          const y = (cellY + 1) * def.fontSize;

          ctx.fillStyle = glyphColor(i, s.length, def.alpha);
          ctx.fillText(s.glyphs[i], x, y);
        }

        // Respawn when fully off-screen
        if (s.headY - s.length > rows) {
          s.headY  = rand(-s.length * 0.5, -2);
          s.length = Math.floor(rand(def.streamLenMin, def.streamLenMax));
          s.speed  = rand(def.speedMin, def.speedMax);
          s.glyphs = Array.from({ length: s.length }, randomChar);
        }
      }

      // Spawn replacement streams to maintain density
      const activePerCol = new Set(streams.map((s) => s.col)).size;
      if (activePerCol < cols * def.density / 100) {
        const missing = Math.ceil(cols * def.density / 100) - activePerCol;
        for (let i = 0; i < missing; i++) {
          const col = Math.floor(Math.random() * cols);
          streams.push(createStream(col, def, rows));
        }
      }
    };

    const frame = (ts: number) => {
      rafId = requestAnimationFrame(frame);
      if (ts - last < frameMs) return;
      last = ts;

      // Fade trail
      ctx.fillStyle = BG_FILL;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      LAYERS.forEach((def, i) => drawLayer(def, layerStreams[i]));
    };

    const onResize = () => { init(); };
    window.addEventListener("resize", onResize);

    init();
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
