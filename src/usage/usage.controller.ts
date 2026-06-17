import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** Public: per-operation token estimates (so the UI can show "≈N tokens"). */
  @Get('costs')
  costs() {
    return this.usage.config();
  }

  /** Today's generation quota for the current user. */
  @Get()
  @UseGuards(JwtAuthGuard)
  status(@Req() req: AuthedRequest) {
    return this.usage.status(req.userId!);
  }
}
