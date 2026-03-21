import { Module } from '@nestjs/common';
import { AgentStateRepository } from './agent-state.repository';
import { TaskStateRepository } from './task-state.repository';
import { TeamStateRepository } from './team-state.repository';
import { ProjectStateRepository } from './project-state.repository';

@Module({
  providers: [AgentStateRepository, TaskStateRepository, TeamStateRepository, ProjectStateRepository],
  exports: [AgentStateRepository, TaskStateRepository, TeamStateRepository, ProjectStateRepository],
})
export class StateModule {}
