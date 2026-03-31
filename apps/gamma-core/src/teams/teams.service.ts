/**
 * teams.service.ts — Business logic for team CRUD operations.
 *
 * Manages team lifecycle: creation, updates, deletion, and backlog queries.
 * Delegates persistence to TeamStateRepository and emits activity events.
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { TeamStateRepository, type TeamStateRecord } from '../state/team-state.repository';
import { AgentStateRepository, type AgentStateRecord } from '../state/agent-state.repository';
import { TaskStateRepository, type TaskRecord, type TaskFindFilters } from '../state/task-state.repository';
import { ActivityStreamService } from '../activity/activity-stream.service';
import { AgentFactoryService, type AgentInstanceDto } from '../agents/agent-factory.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly teamRepo: TeamStateRepository,
    private readonly agentStateRepo: AgentStateRepository,
    private readonly taskRepo: TaskStateRepository,
    private readonly activity: ActivityStreamService,
    private readonly agentFactory: AgentFactoryService,
  ) {}

  /** Create a new team with a generated ULID-based ID. */
  createTeam(name: string, description: string, blueprint?: string): TeamStateRecord {
    const id = `team.${ulid()}`;
    const now = Date.now();

    const record: TeamStateRecord = {
      id,
      name,
      description,
      blueprint: blueprint ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.teamRepo.insert(record);
    this.logger.log(`Team created: "${name}" (${id})`);

    this.activity.emit({
      kind: 'team_created',
      agentId: 'system',
      payload: `Team "${name}" created`,
      severity: 'info',
    });

    return record;
  }

  /**
   * Atomic: create team + leader agent in one call.
   * Used by the Syndicate Map inline "Create Team" flow.
   */
  async createTeamWithLeader(opts: {
    name: string;
    description?: string;
    leaderRoleId: string;
    leaderName?: string;
  }): Promise<{ team: TeamStateRecord; leader: AgentInstanceDto }> {
    const role = this.agentFactory.findRole(opts.leaderRoleId);
    if (!role) {
      throw new BadRequestException(`Unknown role: "${opts.leaderRoleId}"`);
    }

    const leaderName = opts.leaderName?.trim() || role.name;
    const team = this.createTeam(opts.name, opts.description ?? '');

    const leader = await this.agentFactory.createAgent({
      roleId: opts.leaderRoleId,
      name: leaderName,
      teamId: team.id,
    });

    this.logger.log(`Team "${opts.name}" (${team.id}) created with leader "${leaderName}" (${leader.agentId})`);

    return { team, leader };
  }

  /** Return all teams. */
  findAll(): TeamStateRecord[] {
    return this.teamRepo.findAll();
  }

  /** Find a team by ID, throws NotFoundException if not found. */
  findById(id: string): TeamStateRecord {
    const team = this.teamRepo.findById(id);
    if (!team) {
      throw new NotFoundException(`Team not found: ${id}`);
    }
    return team;
  }

  /** Return a team with its member agents. */
  getTeamWithMembers(id: string): { team: TeamStateRecord; members: AgentStateRecord[] } {
    const team = this.findById(id);
    const members = this.teamRepo.findMembers(id);
    return { team, members };
  }

  /** Partial update of team metadata. */
  update(id: string, fields: Partial<Pick<TeamStateRecord, 'name' | 'description'>>): TeamStateRecord {
    this.findById(id); // ensure exists
    this.teamRepo.update(id, { ...fields, updatedAt: Date.now() });
    return this.findById(id);
  }

  /**
   * Delete (archive) a team. Moves all member agents to unassigned
   * by setting their teamId to null.
   */
  deleteTeam(id: string): { ok: true } {
    const team = this.findById(id);
    const members = this.teamRepo.findMembers(id);

    // Unassign all agents from the team
    for (const agent of members) {
      this.agentStateRepo.upsert({
        ...agent,
        teamId: null,
        updatedAt: Date.now(),
      });
    }

    this.teamRepo.delete(id);
    this.logger.log(`Team deleted: "${team.name}" (${id}), ${members.length} agent(s) unassigned`);

    return { ok: true };
  }

  /** Get the task backlog for a team with optional filters. */
  getBacklog(teamId: string, filters?: TaskFindFilters): TaskRecord[] {
    this.findById(teamId); // ensure team exists
    return this.taskRepo.findByTeam(teamId, filters);
  }
}
