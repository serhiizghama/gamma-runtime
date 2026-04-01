import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { TeamsModule } from './teams/teams.module';
import { AgentsModule } from './agents/agents.module';
import { ClaudeModule } from './claude/claude.module';
import { ProjectsRepository } from './repositories/projects.repository';
import { TasksRepository } from './repositories/tasks.repository';
import { TraceRepository } from './repositories/trace.repository';
import { ChatRepository } from './repositories/chat.repository';
import { AgentMessagesRepository } from './repositories/agent-messages.repository';

@Module({
  imports: [DatabaseModule, TeamsModule, AgentsModule, ClaudeModule],
  controllers: [AppController],
  providers: [
    ProjectsRepository,
    TasksRepository,
    TraceRepository,
    ChatRepository,
    AgentMessagesRepository,
  ],
})
export class AppModule {}
