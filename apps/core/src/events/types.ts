export interface GammaEvent {
  id: string;
  kind: EventKind | string;
  teamId?: string;
  agentId?: string;
  taskId?: string;
  content?: unknown;
  createdAt: number;
}

export type EventKind =
  | 'agent.started'
  | 'agent.thinking'
  | 'agent.message'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'agent.completed'
  | 'agent.error'
  | 'task.created'
  | 'task.assigned'
  | 'task.stage_changed'
  | 'task.completed'
  | 'team.message'
  | 'orchestrator.stage_start'
  | 'orchestrator.stage_end'
  | 'orchestrator.review';
