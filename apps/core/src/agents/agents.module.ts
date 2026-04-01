import { Module, forwardRef } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { RolesService } from './roles.service';
import { WorkspaceService } from './workspace.service';
import { ClaudeMdGenerator } from './claude-md.generator';
import { AgentsRepository } from '../repositories/agents.repository';
import { TeamsRepository } from '../repositories/teams.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { DatabaseModule } from '../database/database.module';
import { TeamsModule } from '../teams/teams.module';
import { ClaudeModule } from '../claude/claude.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => TeamsModule), ClaudeModule],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    RolesService,
    WorkspaceService,
    ClaudeMdGenerator,
    AgentsRepository,
    TeamsRepository,
    TasksRepository,
  ],
  exports: [AgentsService, RolesService, WorkspaceService, ClaudeMdGenerator],
})
export class AgentsModule {}
