import { Module, forwardRef } from '@nestjs/common';
import { StateModule } from '../state/state.module';
import { ActivityModule } from '../activity/activity.module';
import { IpcModule } from '../ipc/ipc.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectDecomposerService } from './project-decomposer.service';

@Module({
  imports: [
    StateModule,
    ActivityModule,
    IpcModule,
    MessagingModule,
    forwardRef(() => SessionsModule),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectDecomposerService],
  exports: [ProjectsService, ProjectDecomposerService],
})
export class ProjectsModule {}
