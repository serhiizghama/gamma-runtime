import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  Logger,
} from '@nestjs/common';
import {
  ScaffoldService,
  ScaffoldRequest,
  ScaffoldResult,
} from './scaffold.service';

@Controller('api/scaffold')
export class ScaffoldController {
  private readonly logger = new Logger(ScaffoldController.name);

  constructor(private readonly scaffoldService: ScaffoldService) {}

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
