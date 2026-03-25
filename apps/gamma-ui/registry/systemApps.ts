import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

type LazyApp = LazyExoticComponent<ComponentType>;

/**
 * System App Registry — single source of truth for built-in application components.
 *
 * To add a new system app:
 *   1. Create the component under apps/system/<appId>/
 *   2. Call registerSystemApp("<appId>", React.lazy(...)) here
 *   3. Add the app definition to constants/apps.ts
 *
 * WindowNode never imports system apps directly — it uses getSystemApp() instead.
 */
const _registry = new Map<string, LazyApp>([
  [
    "terminal",
    lazy(() =>
      import("../apps/system/terminal/TerminalApp").then((m) => ({
        default: m.TerminalApp,
      })),
    ),
  ],
  [
    "settings",
    lazy(() =>
      import("../apps/system/settings/SettingsApp").then((m) => ({
        default: m.SettingsApp,
      })),
    ),
  ],
  [
    "browser",
    lazy(() =>
      import("../apps/system/browser/BrowserApp").then((m) => ({
        default: m.BrowserApp,
      })),
    ),
  ],
  [
    "notes",
    lazy(() =>
      import("../apps/system/notes/NotesApp").then((m) => ({
        default: m.NotesApp,
      })),
    ),
  ],
  [
    "kernel-monitor",
    lazy(() =>
      import("../apps/system/kernel-monitor/KernelMonitorApp").then((m) => ({
        default: m.KernelMonitorApp,
      })),
    ),
  ],
  [
    "agent-monitor",
    lazy(() =>
      import("../apps/system/agent-monitor/AgentMonitorApp").then((m) => ({
        default: m.AgentMonitorApp,
      })),
    ),
  ],
  [
    "sentinel",
    lazy(() =>
      import("../apps/system/sentinel/SentinelApp").then((m) => ({
        default: m.SentinelApp,
      })),
    ),
  ],
  [
    "director",
    lazy(() =>
      import("../apps/system/director/DirectorApp").then((m) => ({
        default: m.DirectorApp,
      })),
    ),
  ],
  [
    "syndicate-map",
    lazy(() =>
      import("../apps/system/syndicate-map/SyndicateMapApp").then((m) => ({
        default: m.SyndicateMapApp,
      })),
    ),
  ],
  [
    "kanban",
    lazy(() =>
      import("../components/KanbanBoard").then((m) => ({
        default: m.KanbanBoard,
      })),
    ),
  ],
  [
    "ceo-dashboard",
    lazy(() =>
      import("../components/CeoDashboard").then((m) => ({
        default: m.CeoDashboard,
      })),
    ),
  ],
  [
    "team-chat",
    lazy(() =>
      import("../apps/system/team-chat/TeamChatApp").then((m) => ({
        default: m.TeamChatApp,
      })),
    ),
  ],
]);

/** Returns the lazy-loaded component for a built-in system app, or undefined. */
export function getSystemApp(appId: string): LazyApp | undefined {
  return _registry.get(appId);
}

/** Registers a new system app component (call during OS bootstrap, outside render). */
export function registerSystemApp(appId: string, component: LazyApp): void {
  _registry.set(appId, component);
}

/** Removes a system app from the registry. */
export function unregisterSystemApp(appId: string): void {
  _registry.delete(appId);
}
