# Gamma OS

> A browser-based operating system UI — macOS-inspired, built with React, TypeScript, and Zustand. Backend powered by NestJS + Redis Streams.

---

## Overview

**Gamma OS** is a fully functional web OS interface designed as a diploma project. The frontend runs entirely in the browser with a dark cyberpunk aesthetic. The backend bridges to the OpenClaw AI Gateway, providing real-time agent sessions via SSE.

---

## Live Demo

```
http://sputniks-mac-mini.tailcde006.ts.net:5173
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript (strict) + Vite 5 |
| State Management | Zustand + Immer + persist middleware |
| Backend | NestJS 10 + Fastify |
| Real-time | Redis Streams + SSE multiplexer |
| Shared Types | `@gamma/types` (monorepo package) |
| Styling | Pure CSS (custom properties, animations, glass morphism) |

---

## Monorepo Structure

```
gamma-os/
├── web/                        # Frontend (React + Vite)
│   ├── components/
│   │   ├── GammaOS.tsx         # Root OS component
│   │   ├── BootScreen.tsx      # Animated boot/splash screen
│   │   ├── Desktop.tsx         # Background + watermark layer
│   │   ├── WindowManager.tsx   # Renders all open windows
│   │   ├── WindowNode.tsx      # Individual window (drag + resize)
│   │   ├── Dock.tsx            # Bottom dock bar
│   │   ├── Launchpad.tsx       # App grid overlay
│   │   └── NotificationCenter.tsx
│   ├── apps/
│   │   ├── TerminalApp.tsx     # Terminal demo
│   │   ├── SettingsApp.tsx     # UI settings controls
│   │   └── KernelMonitorApp.tsx # Backend debug monitor
│   ├── store/
│   │   └── useOSStore.ts       # Zustand store (immer + persist)
│   ├── types/
│   │   └── os.ts               # Frontend TypeScript interfaces
│   ├── hooks/
│   │   └── useSystemEvents.ts  # SSE hook
│   ├── styles/
│   │   └── os-theme.css        # Design system, animations
│   ├── constants/
│   │   └── apps.ts             # App registry
│   ├── src/
│   │   └── main.tsx            # Vite entry point
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── kernel/                     # Backend (NestJS + Fastify)
│   ├── src/
│   │   ├── main.ts             # Server entry point
│   │   ├── app.module.ts       # Root module
│   │   ├── app.controller.ts   # Health check
│   │   ├── gateway/            # OpenClaw Gateway WS bridge
│   │   ├── sessions/           # Session CRUD + event bridge
│   │   ├── sse/                # SSE multiplexer + stream batcher
│   │   └── redis/              # Redis provider (ioredis)
│   ├── .env.example
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   └── package.json
│
├── packages/
│   └── gamma-types/            # Shared TypeScript types (@gamma/types)
│       └── index.ts            # 27 exported types
│
├── docs/
│   ├── architecture/
│   │   ├── phase1-os-core.md       # Phase 1 architecture specification
│   │   └── phase2-backend.md       # Backend integration spec v1.6
│   ├── plans/
│   │   └── phase2-implementation.md # Phase 2 loop plan
│   └── roadmap.md                  # High-level roadmap
│
├── package.json                # Root workspace scripts
└── .gitignore
```

---

## Features

### Window Management
- Drag at 60 FPS — RAF + CSS vars, zero React re-renders during drag
- 8-directional resize with pointer capture
- Minimize to Dock, maximize, close
- Focus management with Z-index stacking

### Desktop
- **Live Nebula** background — animated blobs with breathing gradient
- **Boot Screen** — particle network, glitch text, loading bar, fade to desktop

### Backend (Phase 2)
- **Gateway Bridge** — Ed25519 handshake, exponential backoff reconnect
- **Session Management** — CRUD via REST, Redis Hash mapping
- **Event Classification** — 12-type classifier for gateway events
- **SSE Streaming** — XREAD BLOCK multiplexer, 50ms batching for deltas, 15s heartbeat
- **Shared Types** — `@gamma/types` package with 27 exported types

---

## Getting Started

### Prerequisites

- Node.js 22+
- Redis 7+

### Frontend

```bash
cd web
npm install
npm run dev
```

Dev server at `http://localhost:5173`

### Backend

```bash
cd kernel
cp .env.example .env    # Edit with your values
npm install
npm run build
npm run start:prod
```

API at `http://localhost:3001`

### Root Scripts (convenience)

```bash
npm run dev           # Start frontend dev server
npm run dev:kernel    # Start backend in watch mode
npm run build         # Build frontend
npm run build:kernel  # Build backend
```

---

## Architecture Decisions

- **Zero re-renders during drag**: Window position via CSS variables in RAF — Zustand written only on `pointerup`
- **2-layer window DOM**: Outer `.window` handles position; inner `.window__frame` handles visuals + animation
- **SSE over WebSocket**: One SSE connection per client, XREAD BLOCK from Redis Streams — no WS state management on frontend
- **Stream Batcher**: 50ms debounce for thinking/assistant_delta, immediate passthrough for lifecycle/tool events
- **Session persistence**: `gamma-os-session` in localStorage

---

## License

MIT
