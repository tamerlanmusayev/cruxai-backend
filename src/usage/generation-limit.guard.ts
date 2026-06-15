import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UsageService } from './usage.service';
import { AuthedRequest } from '../auth/jwt.guard';

/**
 * Counts one AI generation against the per-user / global daily caps.
 * Must run AFTER JwtAuthGuard (which sets req.userId).
 */
@Injectable()
export class GenerationLimitGuard implements CanActivate {
  constructor(private readonly usage: UsageService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.userId) this.usage.consume(req.userId);
    return true;
  }
}
