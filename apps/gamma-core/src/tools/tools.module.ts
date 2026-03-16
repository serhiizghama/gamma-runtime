import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_EXECUTORS } from './constants';

@Module({
  providers: [
    ToolExecutorService,
    ToolRegistryService,
    // Default empty array — internal tools will override this via
    // useClass multi-providers in their own modules or in PR 4.
    {
      provide: TOOL_EXECUTORS,
      useValue: [],
    },
  ],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
