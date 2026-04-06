// --- Teams ---
export interface Team {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  created_at: number;
  updated_at: number;
}

// --- Agents ---
export type AgentStatus = 'idle' | 'running' | 'error' | 'archived';

export interface Agent {
  id: string;
  name: string;
  role_id: string;
  specialization: string;
  description: string;
  avatar_emoji: string;
  status: AgentStatus;
  team_id: string | null;
  is_leader: boolean;
  session_id: string | null;
  workspace_path: string | null;
  claude_md_hash: string | null;
  context_tokens: number;
  context_window: number;
  total_turns: number;
  last_active_at: number | null;
  created_at: number;
  updated_at: number;
}

// --- Projects ---
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string;
  team_id: string;
  status: ProjectStatus;
  plan: string | null;
  created_at: number;
  updated_at: number;
}

// --- Tasks ---
export type TaskStage = 'backlog' | 'planning' | 'in_progress' | 'review' | 'done' | 'failed';
export type TaskKind = 'generic' | 'backend' | 'frontend' | 'qa' | 'design' | 'devops';

export interface Task {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  team_id: string;
  stage: TaskStage;
  kind: TaskKind;
  assigned_to: string | null;
  created_by: string | null;
  priority: number;
  result: string | null;
  created_at: number;
  updated_at: number;
}

// --- Trace Events ---
export interface TraceEvent {
  id: string;
  agent_id: string;
  team_id: string | null;
  task_id: string | null;
  kind: string;
  content: string | null;
  created_at: number;
}

// --- Chat Messages ---
export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  team_id: string;
  role: ChatRole;
  agent_id: string | null;
  content: string;
  created_at: number;
}

// --- Agent Messages (inter-agent inbox) ---
export interface AgentMessage {
  id: string;
  team_id: string;
  from_agent: string | null;
  to_agent: string;
  content: string;
  read: boolean;
  created_at: number;
}
