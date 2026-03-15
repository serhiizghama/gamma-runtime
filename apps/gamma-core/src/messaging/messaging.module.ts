import { Module } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service';

@Module({
  providers: [AgentRegistryService],
  exports: [AgentRegistryService],
})
export class MessagingModule {}
