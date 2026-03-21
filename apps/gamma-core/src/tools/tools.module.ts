import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_EXECUTORS } from './constants';
import { SpawnSubAgentTool } from './internal/spawn-sub-agent.tool';
import { SendMessageTool } from './internal/send-message.tool';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { StateModule } from '../state/state.module';
import { IpcModule } from '../ipc/ipc.module';
import { DelegateTaskTool } from '../ipc/delegate-task.tool';
import { ReportStatusTool } from '../ipc/report-status.tool';
import { CreateTeamTaskTool } from './create-team-task.tool';
import { UpdateTaskStatusTool } from './update-task-status.tool';

// SessionsModule removed from imports to break circular:
// GatewayModule → ToolsModule → SessionsModule → GatewayModule.
// SpawnSubAgentTool uses @Optional() SessionsService resolved via ModuleRef at runtime.
@Module({
  imports: [
    MessagingModule,
    ActivityModule,
    StateModule,
    IpcModule,
  ],
  providers: [
    ToolExecutorService,
    ToolRegistryService,
    SpawnSubAgentTool,
    SendMessageTool,
    ReportStatusTool,
    CreateTeamTaskTool,
    UpdateTaskStatusTool,
    {
      provide: TOOL_EXECUTORS,
      useFactory: (
        spawnSubAgent: SpawnSubAgentTool,
        sendMessage: SendMessageTool,
        delegateTask: DelegateTaskTool,
        reportStatus: ReportStatusTool,
        createTeamTask: CreateTeamTaskTool,
        updateTaskStatus: UpdateTaskStatusTool,
      ) => [spawnSubAgent, sendMessage, delegateTask, reportStatus, createTeamTask, updateTaskStatus],
      inject: [
        SpawnSubAgentTool,
        SendMessageTool,
        DelegateTaskTool,
        ReportStatusTool,
        CreateTeamTaskTool,
        UpdateTaskStatusTool,
      ],
    },
  ],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
