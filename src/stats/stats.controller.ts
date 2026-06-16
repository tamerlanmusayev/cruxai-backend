import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEMO_MODE, demoStats } from './demo.util';
import { TtlCache } from '../common/ttl-cache';

interface DayCount {
  day: string;
  count: number;
}

@Controller('stats')
export class StatsController {
  // The aggregate is polled every 15s by every visitor — cache it for 10s so
  // the DB sees one query burst per 10s instead of one per visitor.
  private readonly cache = new TtlCache<Record<string, unknown>>(10_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: RealtimeGateway,
  ) {}

  /** Public, aggregate-only metrics — all real (no fabricated numbers). */
  @Get()
  async get() {
    // `online` is always live; the heavy DB aggregate is cached.
    return { online: this.presence.getOnline(), ...(await this.cache.wrap('agg', () => this.aggregate())) };
  }

  private async aggregate(): Promise<Record<string, unknown>> {
    const [documents, summaries, quizzes, attempts, languages, daily, monthly, today] =
      await Promise.all([
        this.prisma.document.count({ where: { isExample: false } }),
        this.prisma.summary.count(),
        this.prisma.quiz.count(),
        this.prisma.attempt.count(),
        this.prisma.document.findMany({
          where: { language: { not: null }, isExample: false },
          distinct: ['language'],
          select: { language: true },
        }),
        // summaries per day, last 14 days
        this.prisma.$queryRaw<DayCount[]>`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS count
          FROM "Summary"
          WHERE "createdAt" >= NOW() - INTERVAL '14 days'
          GROUP BY 1 ORDER BY 1`,
        // summaries per month, last 6 months
        this.prisma.$queryRaw<DayCount[]>`
          SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS day,
                 COUNT(*)::int AS count
          FROM "Summary"
          WHERE "createdAt" >= NOW() - INTERVAL '6 months'
          GROUP BY 1 ORDER BY 1`,
        this.prisma.summary.count({
          where: {
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        }),
      ]);

    const langCodes = languages.map((l) => l.language).filter(Boolean);

    if (DEMO_MODE) {
      const d = demoStats(Date.now());
      return {
        documents: documents + d.documents,
        summaries: summaries + d.summaries,
        quizzes: quizzes + d.quizzes,
        attempts: attempts + d.attempts,
        summariesToday: today + d.summariesToday,
        languages: langCodes.length ? langCodes : ['ru', 'az', 'en'],
        daily: d.daily,
        monthly: d.monthly,
        countries: d.countries,
        demo: true,
      };
    }

    return {
      documents,
      summaries,
      quizzes,
      attempts,
      summariesToday: today,
      languages: langCodes,
      daily,
      monthly,
      countries: [],
    };
  }
}
