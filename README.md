# Gamma OS

> A browser-based operating system UI — macOS-inspired, built with React, TypeScript, and Zustand.

---

## Overview

**Gamma OS** is a fully functional web OS interface designed as a diploma project. It runs entirely in the browser — no backend required in Phase 1. The UI mimics macOS conventions (window management, Dock, Launchpad, Notifications) with a dark cyberpunk aesthetic and live animated backgrounds.

---

## Live Demo

```
http://sputniks-mac-mini.tailcde006.ts.net:5173
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 + TypeScript (strict) |
| State Management | Zustand + Immer + persist middleware |
| Build Tool | Vite 5 |
| Styling | Pure CSS (custom properties, CSS animations) |
| Animation | CSS keyframes + requestAnimationFrame (Canvas) |
| Persistence | localStorage via Zustand persist |

---

## Features

### Window Management
- Drag windows at 60 FPS — RAF + CSS vars, zero React re-renders during drag
- 8-directional resize with pointer capture
- Minimize to Dock, maximize to fullscreen, close
- Focus management with Z-index stacking
- Minimum window size enforced: 320 × 200 px

### Desktop
- **Live Nebula** background — 5 animated blobs with breathing gradient, CSS keyframes, GPU-accelerated transforms
- **Desktop watermark** — "Gamma OS" + γ network logo always visible behind windows
- **Boot Screen** — animated particle network, glitch text, loading bar, smooth fade to desktop

### Dock
- macOS-style icon bar with hover lift animation
- Shows minimized window slots
- Click to open or restore windows

### Launchpad
- Full-screen app grid overlay
- Keyboard support (Escape to close)

### Notification Center
- Toast notifications with auto-dismiss (5s)
- Slide-in animation, glass morphism style

### Settings App
- Blur intensity slider (40–140 px)
- Animation speed slider (10–60 s)
- Reset all settings

---

## Project Structure

```
gamma-os/
├── components/
│   ├── GammaOS.tsx          # Root OS component
│   ├── BootScreen.tsx       # Animated boot/splash screen
│   ├── Desktop.tsx          # Background + watermark layer
│   ├── WindowManager.tsx    # Renders all open windows
│   ├── WindowNode.tsx       # Individual window (drag + resize)
│   ├── Dock.tsx             # Bottom dock bar
│   ├── Launchpad.tsx        # App grid overlay
│   └── NotificationCenter.tsx
├── apps/
│   ├── TerminalApp.tsx      # Terminal demo (heartbeat + cleanup)
│   ├── SettingsApp.tsx      # UI settings controls
│   └── generated/           # Phase 2: AI-generated apps land here
├── store/
│   └── useOSStore.ts        # Zustand store (immer + persist)
├── types/
│   └── os.ts                # TypeScript interfaces
├── hooks/
│   └── useSystemEvents.ts   # SSE hook (mock in Phase 1)
├── styles/
│   └── os-theme.css         # Design system, animations, glass morphism
└── docs/
    ├── SPEC.md               # Architecture specification
    └── PHASE2_BACKEND_SPEC.md  # Backend integration spec v1.2
```

---

## Architecture Decisions

- **Zero re-renders during drag**: Window position updates via CSS variables (`--win-x`, `--win-y`) directly in RAF — Zustand written only on `pointerup`
- **2-layer window DOM**: Outer `.window` handles position (no animation); inner `.window__frame` handles visuals + `windowOpen` animation — prevents animation from overriding position
- **Session persistence**: `gamma-os-session` in localStorage. Empty windows after session exists = user closed everything deliberately (no auto-respawn)
- **Boot screen**: Canvas particle network (160 nodes, no gravity), glitch text, progress bar over 4s, 900ms fade-out

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

Dev server runs at `http://localhost:5173`

---

## Phase 2 — Backend Integration (Planned)

Phase 2 connects Gamma OS to the **OpenClaw AI Gateway**. Each window becomes an agent session with live streaming:

- **NestJS** backend bridge (WS → OpenClaw Gateway)
- **Redis Streams** for per-window SSE event multiplexing
- **Phase-aware streaming**: lifecycle / thinking / assistant / tool events
- **Session recovery**: F5-resilient state sync via Redis snapshot
- **App scaffolding pipeline**: AI generates `.tsx` → git commit → hot-reload
- **Memory Bus**: hierarchical reasoning tree (`gamma:memory:bus`)

Full spec: [`docs/PHASE2_BACKEND_SPEC.md`](./docs/PHASE2_BACKEND_SPEC.md)

---

## Screenshots

> Boot screen → Desktop → Window management

*Coming soon*

---

## License

MIT
