import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ScaffoldAssetBody {
  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  content!: string;

  @IsIn(['base64', 'utf8'])
  encoding!: 'base64' | 'utf8';
}

export class ScaffoldRequestBody {
  @IsString()
  @IsNotEmpty()
  appId!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsString()
  @IsNotEmpty()
  sourceCode!: string;

  @IsOptional()
  @IsBoolean()
  commit?: boolean;

  @IsOptional()
  @IsBoolean()
  strictCheck?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScaffoldAssetBody)
  files?: ScaffoldAssetBody[];

  @IsOptional()
  @IsString()
  contextDoc?: string;

  @IsOptional()
  @IsString()
  agentPrompt?: string;
}
