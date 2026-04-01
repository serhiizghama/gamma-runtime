import { Module, forwardRef } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { RolesService } from './roles.service';
import { WorkspaceService } from './workspace.service';
import { ClaudeMdGenerator } from './claude-md.generator';
import { AgentsRepository } from '../repositories/agents.repository';
import { TeamsRepository } from '../repositories/teams.repository';
import { DatabaseModule } from '../database/database.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => TeamsModule)],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    RolesService,
    WorkspaceService,
    ClaudeMdGenerator,
    AgentsRepository,
    TeamsRepository,
  ],
  exports: [AgentsService, RolesService, WorkspaceService, ClaudeMdGenerator],
})
export class AgentsModule {}
