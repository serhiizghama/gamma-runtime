import { Module, forwardRef } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_EXECUTORS } from './constants';
import { SpawnSubAgentTool } from './internal/spawn-sub-agent.tool';
import { SendMessageTool } from './internal/send-message.tool';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    forwardRef(() => SessionsModule),
    MessagingModule,
    ActivityModule,
  ],
  providers: [
    ToolExecutorService,
    ToolRegistryService,
    SpawnSubAgentTool,
    SendMessageTool,
    {
      provide: TOOL_EXECUTORS,
      useFactory: (
        spawnSubAgent: SpawnSubAgentTool,
        sendMessage: SendMessageTool,
      ) => [spawnSubAgent, sendMessage],
      inject: [SpawnSubAgentTool, SendMessageTool],
    },
  ],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
