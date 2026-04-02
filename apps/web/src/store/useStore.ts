import { create } from 'zustand';

export interface Agent {
  id: string;
  name: string;
  role_id: string;
  specialization: string;
  description: string;
  avatar_emoji: string;
  status: 'idle' | 'running' | 'error' | 'archived';
  team_id: string | null;
  is_leader: boolean;
  session_id: string | null;
  workspace_path: string | null;
  context_tokens: number;
  context_window: number;
  total_turns: number;
  last_active_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  created_at: number;
  updated_at: number;
  members: Agent[];
}

export interface Notification {
  id: string;
  type: 'info' | 'error' | 'success';
  message: string;
  timestamp: number;
}

interface AppState {
  teams: Team[];
  agents: Agent[];
  selectedTeamId: string | null;
  notifications: Notification[];

  setTeams: (teams: Team[]) => void;
  setAgents: (agents: Agent[]) => void;
  selectTeam: (id: string | null) => void;
  addNotification: (n: Omit<Notification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;
}

let notifCounter = 0;

export const useStore = create<AppState>((set) => ({
  teams: [],
  agents: [],
  selectedTeamId: null,
  notifications: [],

  setTeams: (teams) => set({ teams }),
  setAgents: (agents) => set({ agents }),
  selectTeam: (id) => set({ selectedTeamId: id }),

  addNotification: (n) => {
    const id = `notif_${++notifCounter}`;
    set((s) => ({
      notifications: [
        ...s.notifications,
        { ...n, id, timestamp: Date.now() },
      ],
    }));
    setTimeout(() => {
      set((s) => ({
        notifications: s.notifications.filter((notif) => notif.id !== id),
      }));
    }, 7000);
  },

  dismissNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),
}));
