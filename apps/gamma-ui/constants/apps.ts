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
  { id: "syndicate-map", name: "Syndicate Map", icon: "🗺️" },
  { id: "kanban", name: "Kanban Board", icon: "📋" },
  { id: "ceo-dashboard", name: "CEO Dashboard", icon: "🏢" },
  { id: "team-chat", name: "Team Chat", icon: "💬" },
];
