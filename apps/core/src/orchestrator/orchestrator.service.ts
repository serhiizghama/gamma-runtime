import { Injectable, Logger, ConflictException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ClaudeCliAdapter } from '../claude/claude-cli.adapter';
import type { UsageData } from '../claude/types';
import { SessionPoolService } from '../claude/session-pool.service';
import { AgentsRepository } from '../repositories/agents.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { TraceRepository } from '../repositories/trace.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { EventBusService } from '../events/event-bus.service';
import { ChatService } from '../chat/chat.service';
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
    private readonly workspace: WorkspaceService,
  ) {}

  async onModuleInit() {
    // Reset any agents stuck in 'running' from a previous crash/restart
    await this.resetStaleAgents();

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

  private async resetStaleAgents() {
    const allAgents = await this.agents.findAll();
    const stale = allAgents.filter((a) => a.status === 'running');
    for (const agent of stale) {
      this.logger.warn(`Resetting stale agent "${agent.name}" (${agent.id}) from running → idle`);
      await this.agents.updateStatus(agent.id, 'idle');
    }
    if (stale.length > 0) {
      this.logger.log(`Reset ${stale.length} stale agent(s) to idle`);
    }
  }

  private async handleTaskAssigned(taskId: string, agentId: string): Promise<void> {
    // Don't spawn new agents during emergency stop
    if (this.pool.aborting) return;

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

      // 4. Get agent workspace (where CLAUDE.md lives)
      const agentDir = this.workspace.getAgentPath(teamId, leader.id);

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
      let totalResponseLength = 0;
      let pendingText = '';
      let lastSessionId = leader.session_id;
      let lastUsage: UsageData | undefined;
      let lastModelUsage: Record<string, { contextWindow?: number; context_window?: number }> | undefined;
      let lastNumTurns = 0;

      // Flush accumulated text to chat as a message
      const flushTextToChat = async () => {
        const text = pendingText.trim();
        pendingText = '';
        if (!text) return;
        totalResponseLength += text.length;
        const chatMsg = await this.chat.save({
          teamId,
          role: 'assistant',
          content: text,
          agentId: leader.id,
        });
        this.eventBus.emit({
          kind: 'team.message',
          teamId,
          agentId: leader.id,
          content: chatMsg,
        });
      };

      for await (const chunk of this.claude.run({
        message,
        sessionId: leader.session_id ?? undefined,
        cwd: agentDir,
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
          pendingText += chunk.content;
          this.eventBus.emit({
            kind: 'agent.message',
            teamId,
            agentId: leader.id,
            content: { text: chunk.content },
          });
        } else if (chunk.type === 'tool_use') {
          // Flush text before tool use — this is a logical message boundary
          await flushTextToChat();

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
          // Flush any remaining text at end of session
          await flushTextToChat();

          lastSessionId = chunk.sessionId ?? lastSessionId;
          lastUsage = chunk.usage;
          lastModelUsage = chunk.modelUsage;
          lastNumTurns = chunk.numTurns ?? 0;
        } else if (chunk.type === 'error') {
          await flushTextToChat();
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

      // If aborted by emergency stop, skip all post-completion logic
      // (DB statuses are already reset by the emergency-stop handler)
      if (this.pool.aborting || this.pool.wasKilled(leader.id)) {
        this.pool.clearKilled(leader.id);
        this.logger.warn(`Leader ${leader.name} aborted by emergency stop, skipping post-completion`);
        return;
      }

      if (lastSessionId) {
        await this.agents.updateSessionId(leader.id, lastSessionId);
      }

      // input_tokens is the actual context size (includes cache hits)
      const contextTokens = lastUsage?.input_tokens ?? 0;
      // Extract real context window from model usage data
      const modelEntry = lastModelUsage ? Object.values(lastModelUsage)[0] : undefined;
      const contextWindow = modelEntry?.contextWindow ?? modelEntry?.context_window;
      await this.agents.updateUsage(leader.id, {
        context_tokens: contextTokens,
        total_turns: leader.total_turns + lastNumTurns,
        context_window: contextWindow,
      });

      await this.agents.updateStatus(leader.id, 'idle');

      // Emit completed event
      this.eventBus.emit({
        kind: 'agent.completed',
        teamId,
        agentId: leader.id,
        content: {
          responseLength: totalResponseLength,
          contextTokens,
          numTurns: lastNumTurns,
        },
      });
      await this.trace.insert({
        agent_id: leader.id,
        team_id: teamId,
        kind: 'agent.completed',
        content: JSON.stringify({
          responseLength: totalResponseLength,
          contextTokens,
          numTurns: lastNumTurns,
        }),
      });

      this.logger.log(
        `Leader session completed for team ${teamId}: ${totalResponseLength} chars, ${lastNumTurns} turns`,
      );
    } catch (err) {
      // If aborted by emergency stop, skip error handling
      const members = await this.agents.findByTeam(teamId);
      const leader = members.find((a) => a.is_leader);
      if (leader && (this.pool.aborting || this.pool.wasKilled(leader.id))) {
        this.pool.clearKilled(leader.id);
        this.pool.unregister(leader.id);
        return;
      }
      // On error, reset leader to idle so it can accept new messages
      if (leader && leader.status === 'running') {
        await this.agents.updateStatus(leader.id, 'idle');
        this.pool.unregister(leader.id);
        this.eventBus.emit({
          kind: 'agent.error',
          teamId,
          agentId: leader.id,
          content: { error: String(err) },
        });
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

    const agentDir = this.workspace.getAgentPath(task.team_id, agent.id);

    // Run in background — fire and forget with error handler
    this.runAgentInBackground(agent, task, agentDir).catch((err) => {
      this.logger.error(`Background agent spawn failed for task ${task.id}: ${err}`);
    });
  }

  private async runAgentInBackground(
    agent: Agent,
    task: Task,
    agentDir: string,
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
      let lastUsage: UsageData | undefined;
      let lastModelUsage: Record<string, { contextWindow?: number; context_window?: number }> | undefined;
      let lastNumTurns = 0;
      let taskUpdatedByAgent = false;

      for await (const chunk of this.claude.run({
        message: `Task ${task.id}: ${task.title}\n\n${task.description || 'No additional description.'}`,
        sessionId: agent.session_id ?? undefined,
        cwd: agentDir,
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
          lastModelUsage = chunk.modelUsage;
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

      // If aborted by emergency stop, skip all post-completion logic
      if (this.pool.aborting || this.pool.wasKilled(agent.id)) {
        this.pool.clearKilled(agent.id);
        this.logger.warn(`Agent ${agent.name} aborted by emergency stop, skipping post-completion`);
        return;
      }

      if (lastSessionId) {
        await this.agents.updateSessionId(agent.id, lastSessionId);
      }

      // input_tokens is the actual context size (includes cache hits)
      const contextTokens = lastUsage?.input_tokens ?? 0;
      const modelEntry = lastModelUsage ? Object.values(lastModelUsage)[0] : undefined;
      const contextWindow = modelEntry?.contextWindow ?? modelEntry?.context_window;
      await this.agents.updateUsage(agent.id, {
        context_tokens: contextTokens,
        total_turns: agent.total_turns + lastNumTurns,
        context_window: contextWindow,
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

        // Auto-wake leader when all in-progress tasks are done
        const allTasks = await this.tasks.findByTeam(task.team_id);
        const pendingTasks = allTasks.filter(
          (t) => t.stage === 'in_progress' || t.stage === 'planning',
        );

        if (pendingTasks.length === 0 && leader.status === 'idle' && !this.runningPipelines.has(task.team_id)) {
          const doneTasks = allTasks.filter((t) => t.stage === 'done');
          const summary = doneTasks
            .slice(-10)
            .map((t) => `- "${t.title}" → done`)
            .join('\n');

          this.logger.log(
            `All tasks completed for team ${task.team_id}, waking leader ${leader.name}`,
          );

          // Small delay to let final events propagate
          setTimeout(() => {
            this.handleTeamMessage(
              task.team_id,
              `[SYSTEM] All assigned tasks have been completed by your team members. Here is the status:\n\n${summary}\n\nReview the results (check shared/discoveries/, read agent messages via read-messages, review task results) and continue with the next phase of work.`,
            ).catch((err) => {
              this.logger.error(`Failed to wake leader after task completion: ${err}`);
            });
          }, 2000);
        }
      }

      // Save completion summary to team chat so it's visible in the chat panel
      if (responseText) {
        const summary = responseText.length > 2000
          ? responseText.slice(0, 2000) + '…'
          : responseText;
        const chatMsg = await this.chat.save({
          teamId: task.team_id,
          role: 'assistant',
          content: summary,
          agentId: agent.id,
        });

        this.eventBus.emit({
          kind: 'team.message',
          teamId: task.team_id,
          agentId: agent.id,
          taskId: task.id,
          content: chatMsg,
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
      this.pool.unregister(agent.id);

      // If aborted by emergency stop, skip error handling —
      // DB statuses are already reset by the emergency-stop handler
      if (this.pool.aborting || this.pool.wasKilled(agent.id)) {
        this.pool.clearKilled(agent.id);
        this.logger.warn(`Agent ${agent.name} aborted by emergency stop (in catch), skipping error handling`);
        return;
      }

      this.logger.error(
        `Agent ${agent.name} failed on task "${task.title}": ${err}`,
      );
      await this.agents.updateStatus(agent.id, 'error');

      this.eventBus.emit({
        kind: 'agent.error',
        teamId: task.team_id,
        agentId: agent.id,
        taskId: task.id,
        content: { error: String(err) },
      });

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
