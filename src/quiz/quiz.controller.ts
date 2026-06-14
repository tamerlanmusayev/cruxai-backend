import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('documents/:id/quiz')
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  /** Generate (or fetch) an adaptive quiz for a document. */
  @Post()
  generate(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.quiz.generateOrGet(id, req.userId!);
  }
}
