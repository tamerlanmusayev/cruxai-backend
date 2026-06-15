import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ExamsService } from './exams.service';
import { SubmitAttemptDto } from '../attempts/dto/submit-attempt.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  /** Page load — reuse the latest unsubmitted exam (no AI cost). */
  @Post('documents/:id/exams')
  create(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.exams.create(id, req.userId!, false);
  }

  /** "New exam" — generate a fresh one. Costs money → max 2/min. */
  @Post('documents/:id/exams/new')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  createNew(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.exams.create(id, req.userId!, true);
  }

  /** Submit answers; get score, prediction, and weak-area report. */
  @Post('exams/:id/submit')
  submit(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.exams.submit(id, req.userId!, dto.answers);
  }
}
