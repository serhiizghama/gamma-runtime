import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ScaffoldService } from './scaffold.service';
import type { AppRegistryEntry, ScaffoldResult } from '@gamma/types';
import { ScaffoldRequestBody } from '../dto/scaffold-request.dto';
import { SystemAppGuard } from '../sessions/system-guard';

@Controller('api/scaffold')
export class ScaffoldController {
  private readonly logger = new Logger(ScaffoldController.name);

  constructor(private readonly scaffoldService: ScaffoldService) {}

  @Get('registry')
  async getRegistry(): Promise<Record<string, AppRegistryEntry>> {
    return this.scaffoldService.getRegistry();
  }

  @Post()
  @UseGuards(SystemAppGuard)
  async scaffold(@Body() req: ScaffoldRequestBody): Promise<ScaffoldResult> {
    this.logger.log(`POST /api/scaffold — appId=${req.appId}`);
    return this.scaffoldService.scaffold(req);
  }

  @Delete(':appId')
  @UseGuards(SystemAppGuard)
  async remove(@Param('appId') appId: string): Promise<{ ok: boolean }> {
    this.logger.log(`DELETE /api/scaffold/${appId}`);
    return this.scaffoldService.remove(appId);
  }
}
