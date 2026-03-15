import { Module } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service';
import { MessageBusService } from './message-bus.service';

@Module({
  providers: [AgentRegistryService, MessageBusService],
  exports: [AgentRegistryService, MessageBusService],
})
export class MessagingModule {}
