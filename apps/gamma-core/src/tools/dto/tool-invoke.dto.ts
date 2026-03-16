import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

/**
 * Inbound DTO for tool invocation requests.
 *
 * Validated by the global ValidationPipe at the HTTP boundary.
 * Note: `arguments` receives only a structural @IsObject() check here.
 * The ToolRegistryService performs a secondary, per-tool JSON Schema
 * validation via Ajv before dispatching to any executor.
 */
export class ToolInvokeDto {
  @IsString()
  @IsNotEmpty()
  toolName!: string;

  @IsObject()
  arguments!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  sessionKey!: string;

  @IsString()
  @IsOptional()
  toolCallId?: string;
}
