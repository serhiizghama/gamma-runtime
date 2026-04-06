import { Injectable, NotFoundException, ConflictException, Logger, Inject, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { AgentsRepository } from '../repositories/agents.repository';
import { TeamsRepository } from '../repositories/teams.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { Agent } from '../common/types';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { RolesService } from './roles.service';
import { WorkspaceService } from './workspace.service';
import { ClaudeMdGenerator } from './claude-md.generator';
import { SessionPoolService } from '../claude/session-pool.service';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly agentsRepo: AgentsRepository,
    private readonly teamsRepo: TeamsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly rolesService: RolesService,
    private readonly workspaceService: WorkspaceService,
    private readonly claudeMdGenerator: ClaudeMdGenerator,
    @Inject(forwardRef(() => SessionPoolService))
    private readonly sessionPool: SessionPoolService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(dto: CreateAgentDto): Promise<Agent> {
    const team = await this.teamsRepo.findById(dto.teamId);
    if (!team) throw new NotFoundException(`Team ${dto.teamId} not found`);

    // Ensure team workspace exists
    this.workspaceService.createTeamWorkspace(team.id);

    // Look up role emoji
    const role = this.rolesService.findById(dto.roleId);
    const avatarEmoji = role?.emoji || '🤖';

    // Create agent record
    const agent = await this.agentsRepo.create({
      name: dto.name,
      role_id: dto.roleId,
      team_id: dto.teamId,
      specialization: dto.specialization,
      description: dto.description,
      avatar_emoji: avatarEmoji,
      is_leader: dto.isLeader,
    });

    // Create agent workspace
    const workspacePath = this.workspaceService.createAgentWorkspace(team.id, agent.id);
    await this.agentsRepo.updateWorkspacePath(agent.id, workspacePath);

    // Generate CLAUDE.md for this agent and regenerate for all team members
    await this.regenerateTeamClaudeMd(team.id);

    this.logger.log(`Created agent ${agent.name} (${agent.role_id}) in team ${team.name}`);
    return { ...agent, workspace_path: workspacePath };
  }

  async findAll(): Promise<Agent[]> {
    return this.agentsRepo.findAll();
  }

  async findById(id: string): Promise<Agent> {
    const agent = await this.agentsRepo.findById(id);
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);
    return agent;
  }

  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.agentsRepo.findById(id);
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);

    const fields: Record<string, unknown> = {};
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.specialization !== undefined) fields.specialization = dto.specialization;
    if (dto.description !== undefined) fields.description = dto.description;

    if (Object.keys(fields).length === 0) return agent;

    const updated = await this.agentsRepo.updateFields(id, fields);
    if (!updated) throw new NotFoundException(`Agent ${id} not found`);

    // Regenerate CLAUDE.md for team (agent info changed)
    if (agent.team_id) {
      await this.regenerateTeamClaudeMd(agent.team_id);
    }

    return updated;
  }

  async archive(id: string): Promise<Agent> {
    const agent = await this.agentsRepo.findById(id);
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);

    // Kill running process if active
    if (this.sessionPool.isRunning(id)) {
      const proc = this.sessionPool.getProcess(id);
      if (proc) {
        this.logger.warn(`Killing running agent ${id} before archive`);
        if (proc.pid) {
          try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
        }
      }
      this.sessionPool.unregister(id);
    }

    // Reset in_progress tasks assigned to this agent back to backlog
    await this.tasksRepo.unassignAgent(id);

    const archived = await this.agentsRepo.updateStatus(id, 'archived');
    if (!archived) throw new NotFoundException(`Agent ${id} not found`);

    // Regenerate CLAUDE.md for remaining team members
    if (agent.team_id) {
      await this.regenerateTeamClaudeMd(agent.team_id);
    }

    return archived;
  }

  async resetSession(id: string): Promise<Agent> {
    const agent = await this.agentsRepo.findById(id);
    if (!agent) throw new NotFoundException(`Agent ${id} not found`);

    // 409 if agent is currently running
    if (this.sessionPool.isRunning(id)) {
      throw new ConflictException(`Agent ${id} is currently running. Stop it first.`);
    }

    await this.agentsRepo.resetSession(id);
    return this.findById(id);
  }

  // TODO: Add POST /api/internal/regenerate-team-config endpoint so leader can trigger this via curl
  async regenerateTeamClaudeMd(teamId: string): Promise<void> {
    const team = await this.teamsRepo.findById(teamId);
    if (!team) return;

    const members = await this.agentsRepo.findByTeam(teamId);
    const teamPath = this.workspaceService.getTeamPath(teamId);

    for (const agent of members) {
      const rolePrompt = await this.rolesService.getRolePrompt(agent.role_id);
      const content = this.claudeMdGenerator.generate({
        agent,
        team,
        teamMembers: members,
        rolePrompt,
        isLeader: agent.is_leader,
        teamPath,
      });
      this.workspaceService.writeClaudeMd(teamId, agent.id, content);

      // Hash the generated CLAUDE.md content
      const newHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
      const oldHash = agent.claude_md_hash;

      await this.agentsRepo.updateClaudeMdHash(agent.id, newHash);

      // If hash changed and agent has an active session — notify UI
      if (oldHash && oldHash !== newHash && agent.session_id) {
        this.eventBus.emit({
          kind: 'agent.config_changed',
          teamId,
          agentId: agent.id,
          content: {
            oldHash,
            newHash,
            message: 'CLAUDE.md updated — restart session to apply changes',
          },
        });
        this.logger.warn(
          `Agent ${agent.name} has stale session: CLAUDE.md hash changed ${oldHash} → ${newHash}`,
        );
      }
    }

    this.logger.log(`Regenerated CLAUDE.md for ${members.length} agents in team ${teamId}`);
  }
}
