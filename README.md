# Gamma OS — The Agentic Meta-OS

![Status](https://img.shields.io/badge/status-active%20development-blue)
![Version](https://img.shields.io/badge/version-0.1.0-informational)
![License](https://img.shields.io/badge/license-MIT-green)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-ioredis-DC382D?logo=redis&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)

> A Capability-based Multi-Agent Operating System where LLMs act as programmable co-processors, not chatbots.

---

## 🌌 Vision

Gamma OS is a browser-native, microkernel-based operating system for AI. It is also the subject of a **Master of Science (MSc) thesis** in Human-Computer Interaction and AI Systems Architecture.

The core thesis: **LLMs should not be chatbots. They should be OS co-processors.**

In Gamma OS, every agent is a first-class system process with its own lifecycle, memory space, and managed state. Agents autonomously create, own, and operate micro-applications — self-contained, agent-generated bundles that are scaffolded, compiled, and mounted at runtime inside a live browser desktop. The window you see on screen is not the agent — it's a *viewport* into a long-lived agent process. Closing the window does not terminate the process. The agent continues running in daemon mode.

The entire system communicates through a **Redis Streams Memory Bus** — a persistent, replayable event fabric that enables cross-agent debugging, interaction tracing, and full observability of the agent network.

---

## ✨ Key Features

### 🏗️ Zero-Install App Generation
Agents scaffold complete micro-applications on the fly: a React component (`.tsx`), a context document (`context.md`), and an agent persona (`agent-prompt.md`). The Scaffold Service compiles these into a live bundle mounted inside the OS window manager — no deploy step, no page reload.

### 🔄 Live HMR-Powered App Updates
The frontend is built on Vite with React Fast Refresh. When an agent iterates on an app bundle, the `DynamicAppRenderer` hot-mounts the updated component directly into its window without unmounting the surrounding OS shell. The user sees changes appear in real time.

### 🧠 Redis Memory Bus
All inter-agent and agent-kernel communication flows through Redis Streams (`gamma:memory:bus`). This gives every interaction a persistent, ordered, replayable audit trail — not just logs. Any agent, developer, or the OS itself can subscribe to the bus, replay past interactions, and perform cross-agent debugging.

### 👻 Daemon-Mode Agents
Agent sessions outlive their UI. When a window is closed, the kernel retains the agent's session state, context, and memory. Re-opening the window reconnects to the live process — no cold start, no context loss.

### 🧬 Hierarchical Agent Architecture
- **System Architect** — a privileged global agent with a system-wide view. It can propose, generate, and refactor apps, and orchestrate multi-app workflows.
- **App Owner Agents** — per-app isolated agents with access only to their own bundle, storage, and permissions. Separation of concerns enforced at the agent level.

### 🗄️ Per-App Persistent Storage
The `useAppStorage` hook gives every app a namespaced key-value store backed by Redis. App state (settings, history, drafts, computed cache) survives bundle updates, kernel restarts, and window close/reopen cycles.

---

## 🏛️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Desktop Environment  (React 18 + Vite + Zustand)          │
│                                                            │
│   Menu Bar  │  Window Manager  │  DynamicAppRenderer       │
│             │  (resizable,     │  (live bundle mount,       │
│             │   draggable)     │   React lazy import)       │
└─────────────────────────┬──────────────────────────────────┘
                          │  REST + SSE  (Fastify)
┌─────────────────────────▼──────────────────────────────────┐
│  Microkernel  (NestJS 10 + Fastify)                        │
│                                                            │
│   SessionsService       ScaffoldService    AppRegistry     │
│   SessionRegistryService  GcService        StorageService  │
│   GatewayWsService  ──── Redis Memory Bus ─────────────    │
└─────────────────────────┬──────────────────────────────────┘
                          │  WebSocket  (WS protocol)
┌─────────────────────────▼──────────────────────────────────┐
│  Agent Gateway  (OpenClaw)                                 │
│                                                            │
│   Session isolation  │  Token streaming (SSE)              │
│   Rate limiting      │  LLM backend routing                │
└────────────────────────────────────────────────────────────┘
                          │
                    LLM Backends  (Claude, GPT-4o, …)
```

The three tiers are strictly decoupled:
- **Desktop** talks only to the Microkernel via REST + SSE.
- **Microkernel** owns all OS state (sessions, apps, memory bus) and proxies agent I/O to the Gateway.
- **Gateway** handles LLM authentication, rate limiting, and streaming — the Microkernel never touches LLM credentials directly.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript 5, Vite 5, Zustand, Immer |
| Styling | CSS custom properties (design token system — no external UI framework) |
| Backend | NestJS 10, Fastify, TypeScript 5 |
| Realtime | Server-Sent Events (SSE), WebSocket (`ws`) |
| State / Bus | Redis (ioredis 5), Redis Streams |
| Scheduling | `@nestjs/schedule` (cron jobs, session GC) |
| Crypto | `@noble/ed25519`, `@noble/hashes` (Ed25519 gateway handshake) |
| IDs | ULID (sortable, collision-free session and event IDs) |
| Monorepo | pnpm workspaces, shared `@gamma/types` package |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 22
- **Redis** ≥ 7, running locally on `localhost:6379`
- An **OpenClaw** instance (agent gateway) accessible to the kernel

### Install dependencies

```bash
cd web && npm install && cd ..
cd kernel && npm install && cd ..
```

### Run the Desktop (Frontend)

```bash
npm run dev
# Vite dev server → http://localhost:5173
```

### Run the Microkernel

```bash
cd kernel
cp .env.example .env   # fill in your OpenClaw endpoint + credentials
cd ..
npm run dev:kernel
# NestJS (Fastify) → http://localhost:3000
```

### Build for production

```bash
npm run build          # builds the web frontend
npm run build:kernel   # compiles the NestJS kernel to dist/
npm run start:kernel   # runs the compiled kernel
```

---

## 📁 Repository Structure

```
gamma-os/
├── web/                            # Desktop environment (React + Vite)
│   ├── apps/
│   │   └── system/                 # Built-in OS apps
│   │       ├── terminal/           # Terminal app
│   │       ├── kernel-monitor/     # Kernel health monitor
│   │       └── agent-monitor/      # Agent Control Plane UI (Phase 4)
│   ├── components/                 # OS shell (WindowManager, MenuBar, …)
│   ├── hooks/                      # useAppStorage, useSystemEvents, …
│   ├── store/                      # Zustand OS store
│   └── registry/                   # App registry (system + user apps)
│
├── kernel/                         # Microkernel (NestJS + Fastify)
│   └── src/
│       ├── sessions/               # Session lifecycle, registry, GC
│       ├── gateway/                # OpenClaw WS bridge + SSE streaming
│       ├── scaffold/               # App bundle generation service
│       ├── storage/                # Per-app Redis key-value store
│       └── apps/                   # App registry & bundle management
│
├── packages/
│   └── gamma-types/                # Shared TypeScript contracts (@gamma/types)
│       └── index.ts                # Single source of truth for all shared types
│
└── docs/
    ├── roadmap.md                  # Project roadmap (Phases 1–11)
    ├── architecture/               # Per-phase architecture documents
    ├── plans/                      # Detailed implementation plans
    └── backlog/                    # Deferred features and design notes
```

---

## 🗺️ Roadmap

| Phase | Name | Status |
|---|---|---|
| 1 | Backend Microkernel (NestJS + Redis) | ✅ Complete |
| 2 | OpenClaw Gateway Bridge (SSE streaming) | ✅ Complete |
| 3 | OS Desktop + App Bundle Pipeline | ✅ Complete |
| 3.5 | Security Audit & Refactor | 🚧 In Progress |
| 4 | Agent Control Plane (Monitor, Token Tracking, Lifecycle GC) | 🚀 Active |
| 5 | Data Layer & Virtual Filesystem (SQLite + VFS) | 🔮 Planned |
| 6 | Agent Capability Architecture (ACA — modular capabilities) | 🔮 Planned |
| 7 | Security & Permission Manager (MAC + Privilege Escalation) | 🔮 Planned |
| 8 | Inter-Agent Communication (IPC over Redis Streams) | 🗺️ Future |
| 9 | App Ecosystem & Distribution (App Store) | 🗺️ Future |
| 10 | Autonomous Scheduling & Background Tasks | 🕰️ Future |
| 11 | Self-Evolving Prompt Kernel | 🕰️ Future |

Full roadmap with architectural detail: [`docs/roadmap.md`](./docs/roadmap.md)

---

## Notable Architecture Decisions

- **Zero re-renders during window drag** — window position is driven via CSS custom properties updated in `requestAnimationFrame`; Zustand state is written only on `pointerup`.
- **SSE over WebSocket (client-facing)** — one SSE connection per client, `XREAD BLOCK` from Redis Streams; no WebSocket state management on the frontend.
- **Stream batcher** — 50ms debounce for `thinking` / `assistant_delta` events; immediate passthrough for `lifecycle` and `tool` events.
- **Ed25519 gateway handshake** — the kernel uses `@noble/ed25519` to authenticate with the OpenClaw gateway; LLM credentials never leave the gateway tier.
- **Flat Redis token fields** — `TokenUsage` fields are stored flat in Redis Hashes to enable atomic `HINCRBY` accumulation without read-modify-write cycles.
- **Context separation** — full agent `system_prompt` is stored in a dedicated `gamma:session-context:<sessionKey>` key; the session registry hash holds only a 2000-char snippet, so `getAll()` never transfers large payloads.

---

## License

MIT © Gamma OS Contributors
