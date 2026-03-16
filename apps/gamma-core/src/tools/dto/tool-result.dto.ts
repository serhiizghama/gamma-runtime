import { IsBoolean, IsString, IsNumber, IsOptional } from 'class-validator';

/**
 * Outbound DTO — standardized tool result envelope.
 *
 * Used to validate/serialize responses returned by both internal
 * executors and the external OpenClaw Gateway proxy.
 */
export class ToolResultDto {
  @IsBoolean()
  ok!: boolean;

  @IsString()
  toolName!: string;

  @IsOptional()
  data?: unknown;

  @IsString()
  @IsOptional()
  error?: string;

  @IsNumber()
  durationMs!: number;
}
