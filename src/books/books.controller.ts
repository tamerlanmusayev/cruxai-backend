import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BooksService } from './books.service';
import { RecommendDto } from './dto/recommend.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  /** Search the public-domain catalogue. */
  @Get('search')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  search(@Query('q') q = '') {
    return this.books.search(q);
  }

  /** Catalogue size, for the "X+ books" line. */
  @Get('count')
  async count() {
    return { count: await this.books.count() };
  }

  /** AI-curated reading list for a goal/topic (costs AI → auth + token budget). */
  @Post('recommend')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  recommend(@Req() req: AuthedRequest, @Body() body: RecommendDto) {
    return this.books.recommend(body.topic, body.lang, req.userId);
  }
}
