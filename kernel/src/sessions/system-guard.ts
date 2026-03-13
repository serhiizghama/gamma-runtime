import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards Agent Control Plane endpoints that expose privileged session data.
 * Requires the `X-Gamma-System-Token` header to match the server's
 * `GAMMA_SYSTEM_TOKEN` environment variable.
 *
 * If the env var is not set, ALL requests are rejected (secure by default).
 */
@Injectable()
export class SystemAppGuard implements CanActivate {
  private readonly token: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('GAMMA_SYSTEM_TOKEN', '');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const provided = req.headers['x-gamma-system-token'];

    if (!this.token || provided !== this.token) {
      throw new ForbiddenException({ error: 'system privileges required' });
    }

    return true;
  }
}
