import { Module, forwardRef } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamsRepository } from '../repositories/teams.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { DatabaseModule } from '../database/database.module';
import { AgentsModule } from '../agents/agents.module';
import { ClaudeModule } from '../claude/claude.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => AgentsModule), ClaudeModule, OrchestratorModule, ChatModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsRepository, AgentsRepository, ProjectsRepository, TasksRepository],
  exports: [TeamsService, TeamsRepository],
})
export class TeamsModule {}
