import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** Today's generation quota for the current user. */
  @Get()
  @UseGuards(JwtAuthGuard)
  status(@Req() req: AuthedRequest) {
    return this.usage.status(req.userId!);
  }
}
