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
} from '@nestjs/common';
import { SystemAppGuard } from '../sessions/system-guard';
import { TeamsService } from './teams.service';
import { TeamBlueprintService } from './team-blueprint.service';
import type { TaskStatus, TaskKind } from '../state/task-state.repository';

@Controller('api/teams')
@UseGuards(SystemAppGuard)
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly blueprintService: TeamBlueprintService,
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
