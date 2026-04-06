import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { ClaudeModule } from '../claude/claude.module';
import { AgentsModule } from '../agents/agents.module';
import { ChatModule } from '../chat/chat.module';
import { EventsModule } from '../events/events.module';
import { DatabaseModule } from '../database/database.module';
import { AgentsRepository } from '../repositories/agents.repository';
import { TeamsRepository } from '../repositories/teams.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { TraceRepository } from '../repositories/trace.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';

@Module({
  imports: [ClaudeModule, AgentsModule, ChatModule, EventsModule, DatabaseModule],
  providers: [
    OrchestratorService,
    AgentsRepository,
    TeamsRepository,
    TasksRepository,
    TraceRepository,
    AgentMessagesRepository,
  ],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
