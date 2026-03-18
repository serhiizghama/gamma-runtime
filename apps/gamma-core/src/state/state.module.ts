import { Module } from '@nestjs/common';
import { AgentStateRepository } from './agent-state.repository';
import { TaskStateRepository } from './task-state.repository';

@Module({
  providers: [AgentStateRepository, TaskStateRepository],
  exports: [AgentStateRepository, TaskStateRepository],
})
export class StateModule {}
