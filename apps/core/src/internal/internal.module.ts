import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { AgentsRepository } from '../repositories/agents.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { TraceRepository } from '../repositories/trace.repository';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [InternalController],
  providers: [
    InternalService,
    AgentsRepository,
    TasksRepository,
    ProjectsRepository,
    AgentMessagesRepository,
    TraceRepository,
  ],
  exports: [InternalService],
})
export class InternalModule {}
