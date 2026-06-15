import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Public — aggregate rating + recent reviews (shown on the home page). */
  @Get()
  list() {
    return this.reviews.list();
  }

  /** Leave a review (authenticated, rate-limited). */
  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  create(@Req() req: AuthedRequest, @Body() body: CreateReviewDto) {
    return this.reviews.create(body, req.userId);
  }
}
