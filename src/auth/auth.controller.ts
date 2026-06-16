import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';

class GoogleLoginDto {
  @IsString()
  credential!: string;

  /** Current anonymous token, so the new account adopts its work. */
  @IsOptional()
  @IsString()
  anonToken?: string;
}

class TelegramLoginDto {
  /** Raw Telegram login-widget payload (id, first_name, hash, auth_date, …). */
  @IsObject()
  data!: Record<string, string>;

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

  /** Sign in with the Telegram login widget payload. */
  @Post('telegram')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  telegram(@Body() body: TelegramLoginDto) {
    return this.auth.telegramLogin(body.data, body.anonToken);
  }
}
