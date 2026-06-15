import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { DEMO_MODE, DEMO_REVIEWS } from '../stats/demo.util';
import { TtlCache } from '../common/ttl-cache';

@Injectable()
export class ReviewsService {
  private readonly cache = new TtlCache<unknown>(15_000);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReviewDto, userId?: string) {
    return this.prisma.review.create({
      data: {
        userId,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
        name: dto.name?.trim() || null,
      },
      select: { id: true, rating: true, comment: true, name: true, createdAt: true },
    });
  }

  /** Aggregate rating + the most recent reviews that have a comment. */
  async list() {
    // DEMO_MODE: synthetic rating for local presentations (off in production).
    if (DEMO_MODE) return DEMO_REVIEWS;
    return this.cache.wrap('list', () => this.computeList());
  }

  private async computeList() {
    const [agg, items] = await Promise.all([
      this.prisma.review.aggregate({ _avg: { rating: true }, _count: true }),
      this.prisma.review.findMany({
        where: { comment: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, rating: true, comment: true, name: true, createdAt: true },
      }),
    ]);
    return {
      average: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      count: agg._count,
      items,
    };
  }
}
