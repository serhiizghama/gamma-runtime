import { Injectable, Logger, ConflictException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ClaudeCliAdapter } from '../claude/claude-cli.adapter';
import { SessionPoolService } from '../claude/session-pool.service';
import { AgentsRepository } from '../repositories/agents.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { TraceRepository } from '../repositories/trace.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { EventBusService } from '../events/event-bus.service';
import { ChatService } from '../chat/chat.service';
import { PromptBuilder } from './prompt-builder';
import { WorkspaceService } from '../agents/workspace.service';
import { TeamsRepository } from '../repositories/teams.repository';
import { Agent, Task } from '../common/types';
import { GammaEvent } from '../events/types';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private runningPipelines = new Set<string>();

  constructor(
    private readonly claude: ClaudeCliAdapter,
    private readonly pool: SessionPoolService,
    private readonly agents: AgentsRepository,
    private readonly teams: TeamsRepository,
    private readonly tasks: TasksRepository,
    private readonly trace: TraceRepository,
    private readonly messages: AgentMessagesRepository,
    private readonly eventBus: EventBusService,
    private readonly chat: ChatService,
    private readonly promptBuilder: PromptBuilder,
    private readonly workspace: WorkspaceService,
  ) {}

  onModuleInit() {
    // Listen for task.assigned events to auto-spawn agents
    this.eventBus.onAll((event: GammaEvent) => {
      if (event.kind === 'task.assigned' && event.taskId && event.agentId) {
        this.handleTaskAssigned(event.taskId, event.agentId).catch((err) => {
          this.logger.error(`Failed to spawn agent for task ${event.taskId}: ${err}`);
        });
      }
    });
    this.logger.log('Orchestrator listening for task.assigned events');
  }

  private async handleTaskAssigned(taskId: string, agentId: string): Promise<void> {
    const task = await this.tasks.findById(taskId);
    if (!task) return;

    const agent = await this.agents.findById(agentId);
    if (!agent) return;

    // Don't spawn the leader — they're already running
    if (agent.is_leader) return;

    // Don't spawn if agent is already running
    if (agent.status === 'running') {
      this.logger.warn(`Agent ${agent.name} is already running, skipping spawn`);
      return;
    }

    await this.spawnAgentForTask(task, agent);
  }

  isPipelineRunning(teamId: string): boolean {
    return this.runningPipelines.has(teamId);
  }

  async handleTeamMessage(teamId: string, message: string): Promise<void> {
    // 1. Guard: if pipeline already running → 409
    if (this.runningPipelines.has(teamId)) {
      throw new ConflictException('A pipeline is already running for this team');
    }
    this.runningPipelines.add(teamId);

    try {
      // 2. Save user message to chat
      await this.chat.save({ teamId, role: 'user', content: message });

      // 3. Find leader
      const team = await this.teams.findById(teamId);
      if (!team) throw new NotFoundException(`Team ${teamId} not found`);

      const members = await this.agents.findByTeam(teamId);
      const leader = members.find((a) => a.is_leader);
      if (!leader) throw new NotFoundException('No leader found in team');

      // 4. Build system prompt (includes gamma-tools docs)
      const systemPrompt = await this.promptBuilder.buildLeaderPrompt(
        leader,
        team,
        members,
      );

      // 5. Get project directory (shared workspace)
      const projectDir = this.workspace.getTeamPath(teamId);

      this.logger.log(
        `Starting leader session for team ${teamId}: ${leader.name}`,
      );

      // Emit start event
      await this.agents.updateStatus(leader.id, 'running');
      this.eventBus.emit({
        kind: 'agent.started',
        teamId,
        agentId: leader.id,
        content: { message: message.slice(0, 200) },
      });
      await this.trace.insert({
        agent_id: leader.id,
        team_id: teamId,
        kind: 'agent.started',
        content: JSON.stringify({ message: message.slice(0, 200) }),
      });

      // 6. Run leader CLI session
      let responseText = '';
      let lastSessionId = leader.session_id;
      let lastUsage: { input_tokens: number; output_tokens: number } | undefined;
      let lastNumTurns = 0;

      for await (const chunk of this.claude.run({
        message,
        systemPrompt,
        sessionId: leader.session_id ?? undefined,
        cwd: projectDir,
        agentId: leader.id,
      })) {
        // Register process with pool on first system chunk
        if (chunk.type === 'system' && chunk.subtype === '_process_started') {
          const proc = this.claude.getLastProcess();
          if (proc) {
            this.pool.register(leader.id, proc);
          }
          continue;
        }

        // Stream trace events to SSE
        if (chunk.type === 'thinking') {
          this.eventBus.emit({
            kind: 'agent.thinking',
            teamId,
            agentId: leader.id,
            content: { text: chunk.content.slice(0, 500) },
          });
        } else if (chunk.type === 'text') {
          responseText += chunk.content;
          this.eventBus.emit({
            kind: 'agent.message',
            teamId,
            agentId: leader.id,
            content: { text: chunk.content },
          });
        } else if (chunk.type === 'tool_use') {
          this.eventBus.emit({
            kind: 'agent.tool_use',
            teamId,
            agentId: leader.id,
            content: {
              tool: chunk.toolName,
              input: chunk.toolInput,
            },
          });
          await this.trace.insert({
            agent_id: leader.id,
            team_id: teamId,
            kind: 'agent.tool_use',
            content: JSON.stringify({
              tool: chunk.toolName,
              input: typeof chunk.toolInput === 'string'
                ? chunk.toolInput.slice(0, 500)
                : JSON.stringify(chunk.toolInput).slice(0, 500),
            }),
          });
        } else if (chunk.type === 'tool_result') {
          this.eventBus.emit({
            kind: 'agent.tool_result',
            teamId,
            agentId: leader.id,
            content: { text: chunk.content.slice(0, 500) },
          });
        } else if (chunk.type === 'result') {
          lastSessionId = chunk.sessionId ?? lastSessionId;
          lastUsage = chunk.usage;
          lastNumTurns = chunk.numTurns ?? 0;
        } else if (chunk.type === 'error') {
          this.eventBus.emit({
            kind: 'agent.error',
            teamId,
            agentId: leader.id,
            content: { error: chunk.content },
          });
          await this.trace.insert({
            agent_id: leader.id,
            team_id: teamId,
            kind: 'agent.error',
            content: chunk.content,
          });
        }
      }

      // 7. Update leader session state
      this.pool.unregister(leader.id);

      if (lastSessionId) {
        await this.agents.updateSessionId(leader.id, lastSessionId);
      }

      const contextTokens = lastUsage
        ? lastUsage.input_tokens + lastUsage.output_tokens
        : 0;
      await this.agents.updateUsage(leader.id, {
        context_tokens: contextTokens,
        total_turns: leader.total_turns + lastNumTurns,
      });

      await this.agents.updateStatus(leader.id, 'idle');

      // 8. Save leader response to chat
      if (responseText) {
        await this.chat.save({
          teamId,
          role: 'assistant',
          content: responseText,
          agentId: leader.id,
        });
      }

      // Emit completed event
      this.eventBus.emit({
        kind: 'agent.completed',
        teamId,
        agentId: leader.id,
        content: {
          responseLength: responseText.length,
          contextTokens,
          numTurns: lastNumTurns,
        },
      });
      await this.trace.insert({
        agent_id: leader.id,
        team_id: teamId,
        kind: 'agent.completed',
        content: JSON.stringify({
          responseLength: responseText.length,
          contextTokens,
          numTurns: lastNumTurns,
        }),
      });

      this.logger.log(
        `Leader session completed for team ${teamId}: ${responseText.length} chars, ${lastNumTurns} turns`,
      );
    } catch (err) {
      // On error, reset leader to idle so it can accept new messages
      const members = await this.agents.findByTeam(teamId);
      const leader = members.find((a) => a.is_leader);
      if (leader && leader.status === 'running') {
        await this.agents.updateStatus(leader.id, 'idle');
        this.pool.unregister(leader.id);
      }
      throw err;
    } finally {
      this.runningPipelines.delete(teamId);
    }
  }

  /**
   * Called by InternalService when assign-task creates a task.
   * Spawns agent CLI in background (does NOT block leader).
   */
  async spawnAgentForTask(task: Task, agent: Agent): Promise<void> {
    const team = await this.teams.findById(task.team_id);
    if (!team) {
      this.logger.error(`Team ${task.team_id} not found for task ${task.id}`);
      return;
    }

    const members = await this.agents.findByTeam(task.team_id);

    const systemPrompt = await this.promptBuilder.buildAgentPrompt(
      agent,
      team,
      members,
      task,
    );

    const projectDir = this.workspace.getTeamPath(task.team_id);

    // Run in background — fire and forget with error handler
    this.runAgentInBackground(agent, task, systemPrompt, projectDir).catch((err) => {
      this.logger.error(`Background agent spawn failed for task ${task.id}: ${err}`);
    });
  }

  private async runAgentInBackground(
    agent: Agent,
    task: Task,
    systemPrompt: string,
    projectDir: string,
  ): Promise<void> {
    try {
      await this.pool.acquire();
      await this.agents.updateStatus(agent.id, 'running');
      await this.tasks.updateStage(task.id, 'in_progress');

      this.eventBus.emit({
        kind: 'agent.started',
        teamId: task.team_id,
        agentId: agent.id,
        taskId: task.id,
        content: { taskTitle: task.title },
      });
      await this.trace.insert({
        agent_id: agent.id,
        team_id: task.team_id,
        task_id: task.id,
        kind: 'agent.started',
        content: JSON.stringify({ taskTitle: task.title }),
      });

      this.logger.log(
        `Spawning agent ${agent.name} for task "${task.title}" (${task.id})`,
      );

      let responseText = '';
      let lastSessionId = agent.session_id;
      let lastUsage: { input_tokens: number; output_tokens: number } | undefined;
      let lastNumTurns = 0;
      let taskUpdatedByAgent = false;

      for await (const chunk of this.claude.run({
        message: `Your task: ${task.title}\n\n${task.description || 'No additional description.'}`,
        systemPrompt,
        sessionId: agent.session_id ?? undefined,
        cwd: projectDir,
        agentId: agent.id,
      })) {
        if (chunk.type === 'system' && chunk.subtype === '_process_started') {
          const proc = this.claude.getLastProcess();
          if (proc) {
            this.pool.register(agent.id, proc);
          }
          continue;
        }

        if (chunk.type === 'text') {
          responseText += chunk.content;
          this.eventBus.emit({
            kind: 'agent.message',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { text: chunk.content },
          });
        } else if (chunk.type === 'tool_use') {
          this.eventBus.emit({
            kind: 'agent.tool_use',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { tool: chunk.toolName, input: chunk.toolInput },
          });
          await this.trace.insert({
            agent_id: agent.id,
            team_id: task.team_id,
            task_id: task.id,
            kind: 'agent.tool_use',
            content: JSON.stringify({
              tool: chunk.toolName,
              input: typeof chunk.toolInput === 'string'
                ? chunk.toolInput.slice(0, 500)
                : JSON.stringify(chunk.toolInput).slice(0, 500),
            }),
          });

          // Detect if agent called update-task via curl
          if (
            chunk.toolName === 'Bash' &&
            typeof chunk.toolInput === 'object' &&
            chunk.toolInput !== null &&
            'command' in chunk.toolInput &&
            typeof (chunk.toolInput as Record<string, unknown>).command === 'string' &&
            (chunk.toolInput as Record<string, string>).command.includes('update-task')
          ) {
            taskUpdatedByAgent = true;
          }
        } else if (chunk.type === 'tool_result') {
          this.eventBus.emit({
            kind: 'agent.tool_result',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { text: chunk.content.slice(0, 500) },
          });
        } else if (chunk.type === 'thinking') {
          this.eventBus.emit({
            kind: 'agent.thinking',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { text: chunk.content.slice(0, 300) },
          });
        } else if (chunk.type === 'result') {
          lastSessionId = chunk.sessionId ?? lastSessionId;
          lastUsage = chunk.usage;
          lastNumTurns = chunk.numTurns ?? 0;
        } else if (chunk.type === 'error') {
          this.eventBus.emit({
            kind: 'agent.error',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { error: chunk.content },
          });
          await this.trace.insert({
            agent_id: agent.id,
            team_id: task.team_id,
            task_id: task.id,
            kind: 'agent.error',
            content: chunk.content,
          });
        }
      }

      // Agent run completed
      this.pool.unregister(agent.id);

      if (lastSessionId) {
        await this.agents.updateSessionId(agent.id, lastSessionId);
      }

      const contextTokens = lastUsage
        ? lastUsage.input_tokens + lastUsage.output_tokens
        : 0;
      await this.agents.updateUsage(agent.id, {
        context_tokens: contextTokens,
        total_turns: agent.total_turns + lastNumTurns,
      });

      // If agent didn't call update-task itself, auto-complete
      if (!taskUpdatedByAgent) {
        const currentTask = await this.tasks.findById(task.id);
        if (currentTask && currentTask.stage === 'in_progress') {
          await this.tasks.setResult(
            task.id,
            JSON.stringify({
              summary: 'Agent completed work (auto-detected)',
              autoCompleted: true,
            }),
          );
          this.eventBus.emit({
            kind: 'task.completed',
            teamId: task.team_id,
            agentId: agent.id,
            taskId: task.id,
            content: { autoCompleted: true },
          });
        }
      }

      // Notify leader via inbox
      const teamMembers = await this.agents.findByTeam(task.team_id);
      const leader = teamMembers.find((m) => m.is_leader);
      if (leader && leader.id !== agent.id) {
        await this.messages.insert({
          team_id: task.team_id,
          from_agent: agent.id,
          to_agent: leader.id,
          content: `Task "${task.title}" completed by ${agent.name}.`,
        });
      }

      await this.agents.updateStatus(agent.id, 'idle');

      this.eventBus.emit({
        kind: 'agent.completed',
        teamId: task.team_id,
        agentId: agent.id,
        taskId: task.id,
        content: {
          responseLength: responseText.length,
          contextTokens,
          numTurns: lastNumTurns,
        },
      });
      await this.trace.insert({
        agent_id: agent.id,
        team_id: task.team_id,
        task_id: task.id,
        kind: 'agent.completed',
        content: JSON.stringify({
          responseLength: responseText.length,
          contextTokens,
          numTurns: lastNumTurns,
        }),
      });

      this.logger.log(
        `Agent ${agent.name} completed task "${task.title}": ${responseText.length} chars`,
      );
    } catch (err) {
      this.logger.error(
        `Agent ${agent.name} failed on task "${task.title}": ${err}`,
      );
      this.pool.unregister(agent.id);
      await this.agents.updateStatus(agent.id, 'error');

      // Fail the task on error/timeout
      const currentTask = await this.tasks.findById(task.id);
      if (currentTask && currentTask.stage === 'in_progress') {
        await this.tasks.updateStage(task.id, 'failed');
        this.eventBus.emit({
          kind: 'task.stage_changed',
          teamId: task.team_id,
          agentId: agent.id,
          taskId: task.id,
          content: { from: 'in_progress', to: 'failed', error: String(err) },
        });
      }
    } finally {
      this.pool.release();
    }
  }
}
