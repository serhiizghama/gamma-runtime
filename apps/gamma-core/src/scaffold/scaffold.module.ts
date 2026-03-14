import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AppStorageService } from './app-storage.service';
import { GitWorkspaceService } from './git-workspace.service';
import { ValidationService } from './validation.service';
import { ScaffoldService } from './scaffold.service';
import { ScaffoldController } from './scaffold.controller';
import { ScaffoldAssetsController } from './scaffold-assets.controller';

@Module({
  imports: [RedisModule, forwardRef(() => SessionsModule)],
  controllers: [ScaffoldController, ScaffoldAssetsController],
  providers: [
    AppStorageService,
    GitWorkspaceService,
    ValidationService,
    ScaffoldService,
  ],
  exports: [ScaffoldService, AppStorageService],
})
export class ScaffoldModule {}
