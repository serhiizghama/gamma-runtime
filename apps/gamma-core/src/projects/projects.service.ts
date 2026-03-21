/**
 * projects.service.ts — Business logic for project CRUD operations.
 *
 * Manages project lifecycle: creation, updates, cancellation, and task queries.
 * Delegates persistence to ProjectStateRepository and emits activity events.
 * After project creation, triggers asynchronous decomposition via ProjectDecomposerService.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  ProjectStateRepository,
  type ProjectStateRecord,
  type ProjectType,
  type ProjectFindAllFilters,
} from '../state/project-state.repository';
import { TaskStateRepository, type TaskFindFilters, type TaskStatusCounts } from '../state/task-state.repository';
import { ActivityStreamService } from '../activity/activity-stream.service';
import { ProjectDecomposerService } from './project-decomposer.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectRepo: ProjectStateRepository,
    private readonly taskRepo: TaskStateRepository,
    private readonly activity: ActivityStreamService,
    private readonly projectDecomposer: ProjectDecomposerService,
  ) {}

  /** Create a new project with a generated ULID-based ID. Triggers decomposition asynchronously. */
  createProject(
    name: string,
    description: string,
    type: ProjectType,
    teamId?: string,
  ): ProjectStateRecord {
    const id = `project.${ulid()}`;
    const now = Date.now();

    const record: ProjectStateRecord = {
      id,
      name,
      description,
      type,
      status: 'planning',
      teamId: teamId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.projectRepo.insert(record);
    this.logger.log(`Project created: "${name}" (${id})`);

    this.activity.emit({
      kind: 'project_created',
      agentId: 'system',
      payload: `Project "${name}" created (type=${type})`,
      severity: 'info',
    });

    // Fire-and-forget decomposition
    this.projectDecomposer.decompose(record).catch((err) => {
      this.logger.error(`Decomposition trigger failed for ${id}: ${err}`);
    });

    return record;
  }

  /** Return all projects, optionally filtered. */
  findAll(filters?: ProjectFindAllFilters): ProjectStateRecord[] {
    return this.projectRepo.findAll(filters);
  }

  /** Find a project by ID, throws NotFoundException if not found. */
  findById(id: string): ProjectStateRecord {
    const project = this.projectRepo.findById(id);
    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    return project;
  }

  /** Partial update of project fields. Emits project_status_change if status changed. */
  update(
    id: string,
    fields: Partial<Pick<ProjectStateRecord, 'name' | 'description' | 'status' | 'teamId'>>,
  ): ProjectStateRecord {
    const existing = this.findById(id);

    this.projectRepo.update(id, { ...fields, updatedAt: Date.now() });

    if (fields.status && fields.status !== existing.status) {
      this.activity.emit({
        kind: 'project_status_change',
        agentId: 'system',
        payload: `Project "${existing.name}" status: ${existing.status} -> ${fields.status}`,
        severity: 'info',
      });
    }

    return this.findById(id);
  }

  /** Cancel a project by setting status to cancelled. */
  cancelProject(id: string): ProjectStateRecord {
    return this.update(id, { status: 'cancelled' });
  }

  /** Get tasks for a project, with optional filters. */
  getTasks(projectId: string, filters?: TaskFindFilters) {
    this.findById(projectId); // ensure project exists
    return this.taskRepo.findByProject(projectId, filters);
  }

  /** Get task status counts for a project (for donut charts). */
  getTaskCounts(projectId: string): TaskStatusCounts {
    this.findById(projectId); // ensure project exists
    return this.taskRepo.countByProject(projectId);
  }
}
