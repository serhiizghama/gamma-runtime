import { Module } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service';
import { MessageBusService } from './message-bus.service';
import { FileChangeConsumerService } from './file-change-consumer.service';

@Module({
  providers: [AgentRegistryService, MessageBusService, FileChangeConsumerService],
  exports: [AgentRegistryService, MessageBusService, FileChangeConsumerService],
})
export class MessagingModule {}
