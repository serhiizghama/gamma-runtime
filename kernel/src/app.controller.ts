import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health(): { ok: boolean; version: string } {
    return { ok: true, version: '1.4-kernel' };
  }
}
