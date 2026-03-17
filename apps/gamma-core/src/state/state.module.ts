import { Module } from '@nestjs/common';
import { AgentStateRepository } from './agent-state.repository';

@Module({
  providers: [AgentStateRepository],
  exports: [AgentStateRepository],
})
export class StateModule {}
