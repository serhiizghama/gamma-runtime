import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import type { AgentRole } from '@gamma/types';

export class SpawnAgentBody {
  @IsString()
  @IsNotEmpty()
  appId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(['architect', 'app-owner', 'daemon'])
  role?: AgentRole;

  @IsOptional()
  @IsString()
  supervisorId?: string;

  @IsOptional()
  @IsString()
  initialPrompt?: string;
}
