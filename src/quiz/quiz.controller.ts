import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { QuizService } from './quiz.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';
import { GenerationLimitGuard } from '../usage/generation-limit.guard';

@Controller('documents/:id/quiz')
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  /** Page load — reuse the cached quiz (no AI cost). */
  @Post()
  generate(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.quiz.generateOrGet(id, req.userId!, false);
  }

  /** Explicit refresh — regenerate focused on weak concepts. Costs money → 2/min. */
  @Post('refresh')
  @UseGuards(GenerationLimitGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  refresh(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.quiz.generateOrGet(id, req.userId!, true);
  }
}
