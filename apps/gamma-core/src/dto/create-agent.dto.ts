import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';

export class CreateAgentBody {
  /** Community role id, e.g. "dev/senior-developer". Only alphanumeric, hyphens, slashes. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9/_-]+$/, { message: 'roleId must be alphanumeric with hyphens/slashes only' })
  roleId!: string;

  /** Display name — sanitized, max 100 chars. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customDirectives?: string;

  /** Optional team ID to assign the agent to on creation. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  teamId?: string;
}
