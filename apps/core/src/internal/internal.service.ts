import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AgentsRepository } from '../repositories/agents.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { TraceRepository } from '../repositories/trace.repository';
import { EventBusService } from '../events/event-bus.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkDoneDto } from './dto/mark-done.dto';
import { RequestReviewDto } from './dto/request-review.dto';
import { ReportStatusDto } from './dto/report-status.dto';
import { BroadcastDto } from './dto/broadcast.dto';

@Injectable()
export class InternalService {
  private readonly logger = new Logger(InternalService.name);

  constructor(
    private readonly agents: AgentsRepository,
    private readonly tasks: TasksRepository,
    private readonly projects: ProjectsRepository,
    private readonly messages: AgentMessagesRepository,
    private readonly trace: TraceRepository,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Task Management ──────────────────────────────────────────────

  async assignTask(dto: AssignTaskDto) {
    // 1. Find agent by name in team
    const teamAgents = await this.agents.findByTeam(dto.teamId);
    const agent = teamAgents.find(
      (a) =>
        a.name.toLowerCase() === dto.to.toLowerCase() ||
        a.role_id.toLowerCase().includes(dto.to.toLowerCase()),
    );

    if (!agent) {
      return {
        success: false,
        error: `Agent "${dto.to}" not found in team ${dto.teamId}. Available agents: ${teamAgents.map((a) => a.name).join(', ')}`,
      };
    }

    // 2. Find active project for team (if any)
    const projects = await this.projects.findByTeam(dto.teamId);
    const activeProject = projects.find(
      (p) => p.status === 'planning' || p.status === 'active',
    );

    // 3. Create task
    const task = await this.tasks.create({
      title: dto.title,
      team_id: dto.teamId,
      description: dto.description ?? '',
      project_id: activeProject?.id,
      kind: dto.kind ?? 'generic',
      assigned_to: agent.id,
      created_by: undefined,
      priority: dto.priority ?? 0,
    });

    // 4. Emit trace event
    await this.trace.insert({
      agent_id: agent.id,
      team_id: dto.teamId,
      task_id: task.id,
      kind: 'task.created',
      content: JSON.stringify({ title: dto.title, assignedTo: agent.name }),
    });

    this.eventBus.emit({
      kind: 'task.created',
      teamId: dto.teamId,
      agentId: agent.id,
      taskId: task.id,
      content: { title: dto.title, assignedTo: agent.name, kind: dto.kind },
    });

    this.eventBus.emit({
      kind: 'task.assigned',
      teamId: dto.teamId,
      agentId: agent.id,
      taskId: task.id,
      content: { agentName: agent.name },
    });

    this.logger.log(
      `Task "${dto.title}" assigned to ${agent.name} (${task.id})`,
    );

    return { success: true, taskId: task.id, agentId: agent.id };
  }

  async updateTask(dto: UpdateTaskDto) {
    const task = await this.tasks.findById(dto.taskId);
    if (!task) {
      return { success: false, error: `Task ${dto.taskId} not found` };
    }

    // Map incoming status to task stage
    const stageMap: Record<string, string> = {
      done: 'done',
      failed: 'failed',
      in_progress: 'in_progress',
      review: 'review',
    };
    const newStage = stageMap[dto.status];
    if (!newStage) {
      return {
        success: false,
        error: `Invalid status "${dto.status}". Valid: done, failed, in_progress, review`,
      };
    }

    // If done and has summary, use setResult which also sets stage to done
    if (dto.status === 'done' && dto.summary) {
      const resultPayload = JSON.stringify({
        summary: dto.summary,
        filesChanged: dto.filesChanged ?? [],
      });
      await this.tasks.setResult(dto.taskId, resultPayload);
    } else {
      await this.tasks.updateStage(
        dto.taskId,
        newStage as 'done' | 'failed' | 'in_progress' | 'review',
      );
      // Store summary as result even for non-done statuses if provided
      if (dto.summary) {
        await this.tasks.setResult(dto.taskId, JSON.stringify({
          summary: dto.summary,
          filesChanged: dto.filesChanged ?? [],
        }));
        // setResult forces stage to 'done', so re-set if not done
        if (dto.status !== 'done') {
          await this.tasks.updateStage(
            dto.taskId,
            newStage as 'done' | 'failed' | 'in_progress' | 'review',
          );
        }
      }
    }

    // Emit trace (agent_id FK requires a valid agent)
    const traceAgentId = task.assigned_to ?? task.created_by;
    if (traceAgentId) {
      await this.trace.insert({
        agent_id: traceAgentId,
        team_id: task.team_id,
        task_id: task.id,
        kind: 'task.stage_changed',
        content: JSON.stringify({
          from: task.stage,
          to: newStage,
          summary: dto.summary,
        }),
      });
    }

    const eventKind =
      dto.status === 'done' ? 'task.completed' : 'task.stage_changed';

    this.eventBus.emit({
      kind: eventKind,
      teamId: task.team_id,
      agentId: task.assigned_to ?? undefined,
      taskId: task.id,
      content: {
        from: task.stage,
        to: newStage,
        summary: dto.summary,
        filesChanged: dto.filesChanged,
      },
    });

    this.logger.log(`Task ${dto.taskId} updated: ${task.stage} → ${newStage}`);

    return { success: true, taskId: dto.taskId, stage: newStage };
  }

  async listTasks(query: {
    teamId?: string;
    status?: string;
    assignedTo?: string;
  }) {
    if (!query.teamId) {
      return { success: false, error: 'teamId query parameter is required' };
    }

    let tasks = await this.tasks.findByTeam(query.teamId);

    if (query.status) {
      tasks = tasks.filter((t) => t.stage === query.status);
    }
    if (query.assignedTo) {
      tasks = tasks.filter((t) => t.assigned_to === query.assignedTo);
    }

    return {
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        stage: t.stage,
        kind: t.kind,
        assignedTo: t.assigned_to,
        createdBy: t.created_by,
        priority: t.priority,
        result: t.result ? JSON.parse(t.result) : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    };
  }

  async getTask(taskId: string) {
    const task = await this.tasks.findById(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    // Resolve assigned agent name
    let assignedAgent = null;
    if (task.assigned_to) {
      const agent = await this.agents.findById(task.assigned_to);
      assignedAgent = agent
        ? { id: agent.id, name: agent.name, status: agent.status }
        : null;
    }

    return {
      success: true,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        stage: task.stage,
        kind: task.kind,
        assignedTo: task.assigned_to,
        assignedAgent,
        createdBy: task.created_by,
        priority: task.priority,
        result: task.result ? JSON.parse(task.result) : null,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      },
    };
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendMessage(dto: SendMessageDto) {
    // Resolve sender
    const sender = await this.agents.findById(dto.from);
    if (!sender) {
      return { success: false, error: `Sender agent ${dto.from} not found` };
    }

    // Resolve recipient by name or ID within the sender's team
    const teamAgents = await this.agents.findByTeam(sender.team_id!);
    const recipient = teamAgents.find(
      (a) =>
        a.id === dto.to ||
        a.name.toLowerCase() === dto.to.toLowerCase(),
    );

    if (!recipient) {
      return {
        success: false,
        error: `Recipient "${dto.to}" not found in team. Available: ${teamAgents.map((a) => a.name).join(', ')}`,
      };
    }

    const msg = await this.messages.insert({
      team_id: sender.team_id!,
      from_agent: sender.id,
      to_agent: recipient.id,
      content: dto.message,
    });

    await this.trace.insert({
      agent_id: sender.id,
      team_id: sender.team_id ?? undefined,
      kind: 'message.sent',
      content: JSON.stringify({
        from: sender.name,
        to: recipient.name,
        preview: dto.message.slice(0, 100),
      }),
    });

    this.eventBus.emit({
      kind: 'message.sent',
      teamId: sender.team_id ?? undefined,
      agentId: sender.id,
      content: {
        from: sender.name,
        to: recipient.name,
        messageId: msg.id,
      },
    });

    this.logger.log(`Message sent from ${sender.name} to ${recipient.name}`);

    return { success: true, messageId: msg.id };
  }

  async readMessages(agentId: string, since?: number) {
    if (!agentId) {
      return { success: false, error: 'agentId query parameter is required' };
    }

    const agent = await this.agents.findById(agentId);
    if (!agent) {
      return { success: false, error: `Agent ${agentId} not found` };
    }

    let unread = await this.messages.findUnread(agentId);

    // Filter by since timestamp if provided
    if (since) {
      unread = unread.filter((m) => m.created_at > since);
    }

    // Resolve sender names
    const messagesWithNames = await Promise.all(
      unread.map(async (m) => {
        let fromName = 'system';
        if (m.from_agent) {
          const fromAgent = await this.agents.findById(m.from_agent);
          fromName = fromAgent?.name ?? 'unknown';
        }
        return {
          id: m.id,
          from: m.from_agent,
          fromName,
          content: m.content,
          createdAt: m.created_at,
        };
      }),
    );

    // Mark all as read
    await this.messages.markAllRead(agentId);

    return {
      success: true,
      messages: messagesWithNames,
      count: messagesWithNames.length,
    };
  }

  async broadcast(dto: BroadcastDto) {
    const sender = await this.agents.findById(dto.from);
    if (!sender) {
      return { success: false, error: `Sender agent ${dto.from} not found` };
    }

    const teamAgents = await this.agents.findByTeam(dto.teamId);
    const recipients = teamAgents.filter((a) => a.id !== dto.from);

    if (recipients.length === 0) {
      return { success: false, error: 'No other agents in team to broadcast to' };
    }

    const messageIds: string[] = [];
    for (const recipient of recipients) {
      const msg = await this.messages.insert({
        team_id: dto.teamId,
        from_agent: dto.from,
        to_agent: recipient.id,
        content: dto.message,
      });
      messageIds.push(msg.id);
    }

    await this.trace.insert({
      agent_id: dto.from,
      team_id: dto.teamId,
      kind: 'message.broadcast',
      content: JSON.stringify({
        from: sender.name,
        recipientCount: recipients.length,
        preview: dto.message.slice(0, 100),
      }),
    });

    this.eventBus.emit({
      kind: 'message.broadcast',
      teamId: dto.teamId,
      agentId: dto.from,
      content: {
        from: sender.name,
        recipientCount: recipients.length,
        messageIds,
      },
    });

    this.logger.log(
      `Broadcast from ${sender.name} to ${recipients.length} agents`,
    );

    return {
      success: true,
      recipientCount: recipients.length,
      messageIds,
    };
  }

  // ── Team & Project ───────────────────────────────────────────────

  async listAgents(teamId: string) {
    if (!teamId) {
      return { success: false, error: 'teamId query parameter is required' };
    }

    const agents = await this.agents.findByTeam(teamId);

    return {
      success: true,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        roleId: a.role_id,
        specialization: a.specialization,
        status: a.status,
        isLeader: a.is_leader,
        contextTokens: a.context_tokens,
        contextWindow: a.context_window,
        totalTurns: a.total_turns,
        lastActiveAt: a.last_active_at,
      })),
    };
  }

  async markDone(dto: MarkDoneDto) {
    // Find leader to use as trace agent
    const teamAgents = await this.agents.findByTeam(dto.teamId);
    const leader = teamAgents.find((a) => a.is_leader);
    if (!leader) {
      return { success: false, error: 'No leader found in team' };
    }

    // Find active project for team
    const projects = await this.projects.findByTeam(dto.teamId);
    const activeProject = projects.find(
      (p) => p.status === 'planning' || p.status === 'active',
    );

    if (activeProject) {
      await this.projects.updateStatus(activeProject.id, 'completed');
    }

    // Mark all remaining in-progress tasks as done
    const tasks = await this.tasks.findByTeam(dto.teamId);
    for (const task of tasks) {
      if (task.stage !== 'done' && task.stage !== 'failed') {
        await this.tasks.updateStage(task.id, 'done');
      }
    }

    await this.trace.insert({
      agent_id: leader.id,
      team_id: dto.teamId,
      kind: 'project.completed',
      content: JSON.stringify({
        summary: dto.summary,
        projectId: activeProject?.id,
      }),
    });

    this.eventBus.emit({
      kind: 'project.completed',
      teamId: dto.teamId,
      content: {
        summary: dto.summary,
        projectId: activeProject?.id,
      },
    });

    this.logger.log(`Project marked done for team ${dto.teamId}`);

    return {
      success: true,
      projectId: activeProject?.id ?? null,
      summary: dto.summary,
    };
  }

  async requestReview(dto: RequestReviewDto) {
    const agent = await this.agents.findById(dto.agentId);
    if (!agent) {
      return { success: false, error: `Agent ${dto.agentId} not found` };
    }

    const task = await this.tasks.findById(dto.taskId);
    if (!task) {
      return { success: false, error: `Task ${dto.taskId} not found` };
    }

    // Move task to review stage
    await this.tasks.updateStage(dto.taskId, 'review');

    // Find leader in the team
    const teamAgents = await this.agents.findByTeam(agent.team_id!);
    const leader = teamAgents.find((a) => a.is_leader);

    // Send message to leader if found
    if (leader) {
      const reviewMsg = dto.message
        ? `Review requested for task "${task.title}": ${dto.message}`
        : `Review requested for task "${task.title}"`;

      await this.messages.insert({
        team_id: agent.team_id!,
        from_agent: agent.id,
        to_agent: leader.id,
        content: reviewMsg,
      });
    }

    await this.trace.insert({
      agent_id: dto.agentId,
      team_id: agent.team_id ?? undefined,
      task_id: dto.taskId,
      kind: 'agent.review_request',
      content: JSON.stringify({
        agentName: agent.name,
        taskTitle: task.title,
        message: dto.message,
      }),
    });

    this.eventBus.emit({
      kind: 'agent.review_request',
      teamId: agent.team_id ?? undefined,
      agentId: dto.agentId,
      taskId: dto.taskId,
      content: {
        agentName: agent.name,
        taskTitle: task.title,
        leaderNotified: !!leader,
      },
    });

    this.logger.log(
      `Review requested by ${agent.name} for task ${task.title}`,
    );

    return {
      success: true,
      taskId: dto.taskId,
      stage: 'review',
      leaderNotified: !!leader,
    };
  }

  async reportStatus(dto: ReportStatusDto) {
    const agent = await this.agents.findById(dto.agentId);
    if (!agent) {
      return { success: false, error: `Agent ${dto.agentId} not found` };
    }

    await this.trace.insert({
      agent_id: dto.agentId,
      team_id: agent.team_id ?? undefined,
      task_id: dto.taskId,
      kind: 'agent.status_report',
      content: JSON.stringify({
        agentName: agent.name,
        status: dto.status,
        blockers: dto.blockers,
      }),
    });

    this.eventBus.emit({
      kind: 'agent.status_report',
      teamId: agent.team_id ?? undefined,
      agentId: dto.agentId,
      taskId: dto.taskId,
      content: {
        agentName: agent.name,
        status: dto.status,
        blockers: dto.blockers,
      },
    });

    // If there are blockers, send message to leader
    if (dto.blockers) {
      const teamAgents = await this.agents.findByTeam(agent.team_id!);
      const leader = teamAgents.find((a) => a.is_leader);
      if (leader) {
        await this.messages.insert({
          team_id: agent.team_id!,
          from_agent: agent.id,
          to_agent: leader.id,
          content: `Status report from ${agent.name}: ${dto.status}. Blockers: ${dto.blockers}`,
        });
      }
    }

    this.logger.log(`Status report from ${agent.name}: ${dto.status}`);

    return { success: true };
  }

  async readContext(teamId: string) {
    if (!teamId) {
      return { success: false, error: 'teamId query parameter is required' };
    }

    // Get project info
    const projects = await this.projects.findByTeam(teamId);
    const activeProject = projects.find(
      (p) => p.status === 'planning' || p.status === 'active',
    );

    // Get all tasks with results
    const tasks = await this.tasks.findByTeam(teamId);
    const completedTasks = tasks
      .filter((t) => t.stage === 'done' && t.result)
      .map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        result: t.result ? JSON.parse(t.result) : null,
      }));

    // Get team agents
    const agents = await this.agents.findByTeam(teamId);

    return {
      success: true,
      project: activeProject
        ? {
            id: activeProject.id,
            name: activeProject.name,
            description: activeProject.description,
            status: activeProject.status,
            plan: activeProject.plan ? JSON.parse(activeProject.plan) : null,
          }
        : null,
      completedTasks,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role_id,
        status: a.status,
        isLeader: a.is_leader,
      })),
      taskSummary: {
        total: tasks.length,
        backlog: tasks.filter((t) => t.stage === 'backlog').length,
        inProgress: tasks.filter((t) => t.stage === 'in_progress').length,
        review: tasks.filter((t) => t.stage === 'review').length,
        done: tasks.filter((t) => t.stage === 'done').length,
        failed: tasks.filter((t) => t.stage === 'failed').length,
      },
    };
  }
}
