import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';

class GoogleLoginDto {
  @IsString()
  credential!: string;

  /** Current anonymous token, so the new account adopts its work. */
  @IsOptional()
  @IsString()
  anonToken?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Issue an anonymous session token. */
  @Post('anonymous')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  anonymous() {
    return this.auth.anonymous();
  }

  /** Sign in with a Google ID token; returns our own session token. */
  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  google(@Body() body: GoogleLoginDto) {
    return this.auth.googleLogin(body.credential, body.anonToken);
  }
}
