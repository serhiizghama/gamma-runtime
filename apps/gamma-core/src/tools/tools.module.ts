import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { TOOL_EXECUTORS } from './constants';

@Module({
  providers: [
    ToolRegistryService,
    // Default empty array — internal tools will override this via
    // useClass multi-providers in their own modules or in PR 4.
    {
      provide: TOOL_EXECUTORS,
      useValue: [],
    },
  ],
  exports: [ToolRegistryService],
})
export class ToolsModule {}
