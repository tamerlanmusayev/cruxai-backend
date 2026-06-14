import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Verifies a Google reCAPTCHA v3 token on protected endpoints.
 * If RECAPTCHA_SECRET is not configured, the guard is a no-op (dev mode).
 */
@Injectable()
export class RecaptchaGuard implements CanActivate {
  private readonly log = new Logger(RecaptchaGuard.name);
  private readonly secret = process.env.RECAPTCHA_SECRET;
  private readonly verifyUrl =
    process.env.RECAPTCHA_VERIFY_URL ??
    'https://www.google.com/recaptcha/api/siteverify';
  private readonly minScore = (() => {
    const v = parseFloat(process.env.RECAPTCHA_MIN_SCORE ?? '0.5');
    return Number.isFinite(v) ? v : 0.5;
  })();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.secret) {
      // No secret: allowed in dev, but never silently disabled in production.
      if (process.env.NODE_ENV === 'production') {
        this.log.error('RECAPTCHA_SECRET is not set in production');
        throw new ForbiddenException('Captcha is not configured');
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const token =
      (req.headers['x-recaptcha-token'] as string) ||
      (req.body && (req.body.recaptchaToken as string));

    if (!token) throw new ForbiddenException('Missing captcha token');

    try {
      const res = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secret, response: token }),
      });
      const data = (await res.json()) as {
        success: boolean;
        score?: number;
      };
      if (!data.success || (data.score ?? 0) < this.minScore) {
        throw new ForbiddenException('Captcha verification failed');
      }
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.log.error(`reCAPTCHA verify error: ${err}`);
      throw new ForbiddenException('Captcha verification unavailable');
    }
  }
}
