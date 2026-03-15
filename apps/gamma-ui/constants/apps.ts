export interface AppDefinition {
  id: string;
  name: string;
  icon: string; // emoji or SVG string
}

export const INSTALLED_APPS: AppDefinition[] = [
  { id: "browser",  name: "Browser",  icon: "🌐" },
  { id: "terminal", name: "Terminal", icon: "⌨️" },
  { id: "settings", name: "Settings", icon: "⚙️" },
  { id: "notes",    name: "Notes",    icon: "📝" },
  { id: "agent-monitor", name: "Agent Monitor", icon: "📡" },
  { id: "sentinel", name: "Sentinel", icon: "🛡️" },
  { id: "director", name: "Director", icon: "🎬" },
];
