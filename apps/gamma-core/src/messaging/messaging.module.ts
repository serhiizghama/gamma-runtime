import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AgentRegistryService } from './agent-registry.service';
import { MessageBusService } from './message-bus.service';

@Module({
  imports: [ActivityModule],
  providers: [AgentRegistryService, MessageBusService],
  exports: [AgentRegistryService, MessageBusService],
})
export class MessagingModule {}
