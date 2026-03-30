/**
 * teams.controller.ts — Teams & Blueprints API
 *
 * Endpoints:
 *   GET    /api/teams                — List all teams
 *   POST   /api/teams                — Create team manually
 *   GET    /api/teams/blueprints     — List available blueprints
 *   POST   /api/teams/spawn-blueprint — Spawn a team from a blueprint
 *   GET    /api/teams/:id            — Get team details + members
 *   PATCH  /api/teams/:id            — Update team metadata
 *   DELETE /api/teams/:id            — Archive team (moves agents to unassigned)
 *   GET    /api/teams/:id/backlog    — Get team's task backlog
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { SystemAppGuard } from '../sessions/system-guard';
import { TeamsService } from './teams.service';
import { TeamBlueprintService } from './team-blueprint.service';
import { SessionsService } from '../sessions/sessions.service';
import type { TaskStatus, TaskKind } from '../state/task-state.repository';

@Controller('api/teams')
@UseGuards(SystemAppGuard)
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(
    private readonly teamsService: TeamsService,
    private readonly blueprintService: TeamBlueprintService,
    private readonly sessionsService: SessionsService,
  ) {}

  // ── Team CRUD ──────────────────────────────────────────────────────

  /** List all teams. */
  @Get()
  listTeams() {
    return this.teamsService.findAll();
  }

  /** Create a team manually. */
  @Post()
  createTeam(@Body() body: { name: string; description?: string }) {
    return this.teamsService.createTeam(body.name, body.description ?? '');
  }

  /** List available blueprints. (Must be above :id routes) */
  @Get('blueprints')
  listBlueprints() {
    return this.blueprintService.getBlueprints();
  }

  /** Spawn a team from a blueprint. (Must be above :id routes) */
  @Post('spawn-blueprint')
  async spawnFromBlueprint(@Body() body: { blueprintId: string }) {
    return this.blueprintService.spawnFromBlueprint(body.blueprintId);
  }

  /** Get team details with member agents. */
  @Get(':id')
  getTeam(@Param('id') id: string) {
    return this.teamsService.getTeamWithMembers(id);
  }

  /** Partial update of team metadata. */
  @Patch(':id')
  updateTeam(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.teamsService.update(id, body);
  }

  /** Delete a team (unassigns all member agents). */
  @Delete(':id')
  @HttpCode(200)
  deleteTeam(@Param('id') id: string) {
    return this.teamsService.deleteTeam(id);
  }

  /**
   * Send a message to the team's leader agent.
   * Automatically activates the leader's session if needed.
   * The message is delivered via Gateway so the agent actually processes it.
   */
  @Post(':id/message')
  @HttpCode(200)
  async sendTeamMessage(
    @Param('id') id: string,
    @Body() body: { message: string },
  ) {
    if (!body.message?.trim()) {
      return { ok: false, error: 'Message is required' };
    }

    // Find team members
    const teamData = this.teamsService.getTeamWithMembers(id);
    if (!teamData || !teamData.members?.length) {
      return { ok: false, error: `Team '${id}' not found or has no members` };
    }

    // Find squad leader: by role name or first member
    const leader = teamData.members.find(
      (m: any) =>
        m.roleId?.includes('squad-leader') ||
        m.roleId?.includes('leader') ||
        m.name?.toLowerCase().includes('leader') ||
        m.name?.toLowerCase().includes('lead'),
    ) ?? teamData.members[0];

    if (!leader) {
      return { ok: false, error: 'No team leader found' };
    }

    // Ensure leader has an active session
    const sessionResult = await this.sessionsService.openAgentSession(leader.id);
    if (!sessionResult.ok) {
      this.logger.warn(`Failed to activate leader session: ${sessionResult.error}`);
    }

    const windowId = sessionResult.windowId;
    if (!windowId) {
      return { ok: false, error: 'Could not activate leader session' };
    }

    // Also activate other team members so leader can delegate to them
    for (const member of teamData.members) {
      if (member.id !== leader.id) {
        this.sessionsService.openAgentSession(member.id).catch((err: unknown) => {
          this.logger.debug(`Failed to pre-activate member ${member.id}: ${err}`);
        });
      }
    }

    // Send message through Gateway (this actually wakes the agent)
    const result = await this.sessionsService.sendMessage(windowId, body.message);
    if (!result || !result.ok) {
      return {
        ok: false,
        error: result?.error?.message ?? 'Failed to deliver message to leader',
      };
    }

    this.logger.log(`Team message delivered to ${leader.name} (${leader.id}) via ${windowId}`);
    return { ok: true, leaderId: leader.id, leaderName: leader.name, windowId };
  }

  /** Get the team's task backlog with optional filters. */
  @Get(':id/backlog')
  getBacklog(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);

    return this.teamsService.getBacklog(id, {
      status: status as TaskStatus | undefined,
      kind: kind as TaskKind | undefined,
      limit,
      offset,
    });
  }
}
