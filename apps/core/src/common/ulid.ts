import { ulid } from 'ulid';

export const teamId = () => `team_${ulid()}`;
export const agentId = () => `agent_${ulid()}`;
export const projectId = () => `proj_${ulid()}`;
export const taskId = () => `task_${ulid()}`;
export const traceEventId = () => `evt_${ulid()}`;
export const chatMessageId = () => `msg_${ulid()}`;
export const agentMessageId = () => `amsg_${ulid()}`;
