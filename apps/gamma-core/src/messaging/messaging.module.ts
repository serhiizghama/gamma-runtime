import { Module } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service';
import { MessageBusService } from './message-bus.service';
import { FileChangeConsumerService } from './file-change-consumer.service';
import { FileWatcherService } from './file-watcher.service';

@Module({
  providers: [AgentRegistryService, MessageBusService, FileChangeConsumerService, FileWatcherService],
  exports: [AgentRegistryService, MessageBusService, FileChangeConsumerService, FileWatcherService],
})
export class MessagingModule {}
