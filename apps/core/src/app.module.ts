import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { TeamsRepository } from './repositories/teams.repository';
import { AgentsRepository } from './repositories/agents.repository';
import { ProjectsRepository } from './repositories/projects.repository';
import { TasksRepository } from './repositories/tasks.repository';
import { TraceRepository } from './repositories/trace.repository';
import { ChatRepository } from './repositories/chat.repository';
import { AgentMessagesRepository } from './repositories/agent-messages.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [AppController],
  providers: [
    TeamsRepository,
    AgentsRepository,
    ProjectsRepository,
    TasksRepository,
    TraceRepository,
    ChatRepository,
    AgentMessagesRepository,
  ],
  exports: [
    DatabaseModule,
    TeamsRepository,
    AgentsRepository,
    ProjectsRepository,
    TasksRepository,
    TraceRepository,
    ChatRepository,
    AgentMessagesRepository,
  ],
})
export class AppModule {}
