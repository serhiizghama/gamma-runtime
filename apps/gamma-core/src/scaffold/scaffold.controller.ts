import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Logger,
} from '@nestjs/common';
import { ScaffoldService } from './scaffold.service';
import type { AppRegistryEntry, ScaffoldRequest, ScaffoldResult } from '@gamma/types';

@Controller('api/scaffold')
export class ScaffoldController {
  private readonly logger = new Logger(ScaffoldController.name);

  constructor(private readonly scaffoldService: ScaffoldService) {}

  @Get('registry')
  async getRegistry(): Promise<Record<string, AppRegistryEntry>> {
    return this.scaffoldService.getRegistry();
  }

  @Post()
  async scaffold(@Body() req: ScaffoldRequest): Promise<ScaffoldResult> {
    this.logger.log(`POST /api/scaffold — appId=${req.appId}`);
    return this.scaffoldService.scaffold(req);
  }

  @Delete(':appId')
  async remove(@Param('appId') appId: string): Promise<{ ok: boolean }> {
    this.logger.log(`DELETE /api/scaffold/${appId}`);
    return this.scaffoldService.remove(appId);
  }
}
