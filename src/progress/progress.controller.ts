import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { MasteryService } from './mastery.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly mastery: MasteryService) {}

  /** Per-concept mastery for the current user. */
  @Get()
  get(@Req() req: AuthedRequest) {
    return this.mastery.progress(req.userId!);
  }
}
