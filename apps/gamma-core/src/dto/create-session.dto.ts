import { IsString, IsNotEmpty } from 'class-validator';

export class CreateSessionBody {
  @IsString()
  @IsNotEmpty()
  windowId!: string;

  @IsString()
  @IsNotEmpty()
  appId!: string;

  @IsString()
  @IsNotEmpty()
  sessionKey!: string;

  @IsString()
  @IsNotEmpty()
  agentId!: string;
}
