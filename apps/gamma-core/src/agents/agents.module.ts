import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagingModule } from '../messaging/messaging.module';
import { StateModule } from '../state/state.module';
import { AgentsController } from './agents.controller';
import { AgentCreatorService } from './agent-creator.service';
import { AgentFactoryService } from './agent-factory.service';

@Module({
  imports: [StateModule, MessagingModule, SessionsModule],
  controllers: [AgentsController],
  providers: [AgentCreatorService, AgentFactoryService],
  exports: [AgentFactoryService],
})
export class AgentsModule {}
