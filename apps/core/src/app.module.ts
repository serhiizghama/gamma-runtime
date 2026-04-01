import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { TeamsModule } from './teams/teams.module';
import { AgentsModule } from './agents/agents.module';
import { ClaudeModule } from './claude/claude.module';
import { EventsModule } from './events/events.module';
import { SseModule } from './sse/sse.module';
import { TraceModule } from './trace/trace.module';
import { InternalModule } from './internal/internal.module';
import { ProjectsRepository } from './repositories/projects.repository';
import { TasksRepository } from './repositories/tasks.repository';
import { ChatRepository } from './repositories/chat.repository';
import { AgentMessagesRepository } from './repositories/agent-messages.repository';

@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    TeamsModule,
    AgentsModule,
    ClaudeModule,
    SseModule,
    TraceModule,
    InternalModule,
  ],
  controllers: [AppController],
  providers: [
    ProjectsRepository,
    TasksRepository,
    ChatRepository,
    AgentMessagesRepository,
  ],
})
export class AppModule {}
