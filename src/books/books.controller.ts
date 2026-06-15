import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BooksService } from './books.service';

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
}
