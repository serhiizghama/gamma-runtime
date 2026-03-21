/**
 * projects.controller.ts — Projects API
 *
 * Endpoints:
 *   GET    /api/projects              — List all projects (filterable: ?status=x&type=x&team_id=x)
 *   POST   /api/projects              — Create project (triggers decomposition)
 *   GET    /api/projects/:id          — Get project details
 *   PATCH  /api/projects/:id          — Update project (status transitions)
 *   DELETE /api/projects/:id          — Cancel project
 *   GET    /api/projects/:id/tasks    — Get tasks for project (paginated)
 *   GET    /api/projects/:id/counts   — Get task status counts for project
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
import { ProjectsService } from './projects.service';
import type { ProjectType, ProjectStatus } from '../state/project-state.repository';
import type { TaskStatus, TaskKind } from '../state/task-state.repository';

@Controller('api/projects')
@UseGuards(SystemAppGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Project CRUD ──────────────────────────────────────────────────────

  /** List all projects, optionally filtered by status, type, or team_id. */
  @Get()
  listProjects(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('team_id') teamId?: string,
  ) {
    return this.projectsService.findAll({
      status: status as ProjectStatus | undefined,
      type: type as ProjectType | undefined,
      teamId: teamId || undefined,
    });
  }

  /** Create a new project. Triggers async decomposition. */
  @Post()
  createProject(
    @Body() body: { name: string; description: string; type: 'epic' | 'continuous'; team_id?: string },
  ) {
    return this.projectsService.createProject(
      body.name,
      body.description,
      body.type,
      body.team_id,
    );
  }

  /** Get a single project by ID. */
  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectsService.findById(id);
  }

  /** Partial update of a project. */
  @Patch(':id')
  updateProject(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; status?: ProjectStatus; team_id?: string },
  ) {
    return this.projectsService.update(id, {
      name: body.name,
      description: body.description,
      status: body.status,
      teamId: body.team_id,
    });
  }

  /** Cancel a project. */
  @Delete(':id')
  @HttpCode(200)
  cancelProject(@Param('id') id: string) {
    return this.projectsService.cancelProject(id);
  }

  /** Get tasks for a project, with optional filters and pagination. */
  @Get(':id/tasks')
  getProjectTasks(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);

    return this.projectsService.getTasks(id, {
      status: status as TaskStatus | undefined,
      kind: kind as TaskKind | undefined,
      limit,
      offset,
    });
  }

  /** Get task status counts for a project (for donut charts). */
  @Get(':id/counts')
  getProjectTaskCounts(@Param('id') id: string) {
    return this.projectsService.getTaskCounts(id);
  }
}
