import { Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Issue an anonymous session token. */
  @Post('anonymous')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  anonymous() {
    return this.auth.anonymous();
  }
}
