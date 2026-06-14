import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ExamsService } from './exams.service';
import { SubmitAttemptDto } from '../attempts/dto/submit-attempt.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  /** Create a timed exam for a document. */
  @Post('documents/:id/exams')
  create(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.exams.create(id, req.userId!);
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
