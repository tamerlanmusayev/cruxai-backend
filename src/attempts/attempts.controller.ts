import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AttemptsService } from './attempts.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('quizzes/:quizId/attempts')
@UseGuards(JwtAuthGuard)
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post()
  submit(
    @Req() req: AuthedRequest,
    @Param('quizId') quizId: string,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.attempts.submit(quizId, dto.answers, req.userId!);
  }
}
