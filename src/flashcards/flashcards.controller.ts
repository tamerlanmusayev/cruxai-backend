import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FlashcardsService } from './flashcards.service';
import { ReviewDto } from './dto/review.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class FlashcardsController {
  constructor(private readonly flashcards: FlashcardsService) {}

  /** Generate (or fetch) the deck for a document the user owns. */
  @Post('documents/:id/flashcards')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  generate(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.flashcards.generateOrGet(id, req.userId!);
  }

  /** The current user's due review queue. */
  @Get('flashcards/due')
  due(@Req() req: AuthedRequest) {
    return this.flashcards.due(req.userId!);
  }

  /** Submit a spaced-repetition grade for a card. */
  @Post('flashcards/:id/review')
  @UseGuards(JwtAuthGuard)
  review(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.flashcards.review(req.userId!, id, dto.grade);
  }
}
