import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Estimated token cost (input + output, rounded) of each AI operation.
 * These are deliberate over-estimates used for an internal daily budget —
 * a cost guard, not exact Anthropic billing.
 */
export const TOKEN_COST = {
  summary: 40_000, // upload → summarize the document (the heavy one)
  overview: 6_000, // AI overview of a copyrighted book (no big input)
  quiz: 12_000, // generate / refresh a quiz
  flashcards: 8_000, // generate a flashcard deck
  graph: 8_000, // extract the knowledge graph
  exam: 12_000, // generate a timed exam
  synthesis: 12_000, // compare 2–5 documents
  grade: 4_000, // grade a quiz attempt + explanations
  recommend: 4_000, // AI reading-list recommendation
} as const;

export type GenKind = keyof typeof TOKEN_COST;

// A full single-document flow: summary + quiz + flashcards + graph + exam + one grading.
export const FULL_FLOW_TOKENS =
  TOKEN_COST.summary +
  TOKEN_COST.quiz +
  TOKEN_COST.flashcards +
  TOKEN_COST.graph +
  TOKEN_COST.exam +
  TOKEN_COST.grade; // ≈ 84k

const GLOBAL_KEY = '__global__';

/**
 * Daily AI-token budget to protect against runaway spend, persisted in Postgres
 * (`UsageCounter`) so it survives restarts and is shared across API instances.
 * Per-user cap defaults to 3× a full flow (~3 documents/day); a '__global__'
 * row is the platform-wide kill-switch. Counters are keyed by UTC day, so they
 * naturally reset at midnight (old rows are harmless and can be pruned later).
 */
@Injectable()
export class UsageService {
  private readonly log = new Logger(UsageService.name);
  private readonly userCap =
    Number(process.env.USER_DAILY_TOKEN_CAP) || 3 * FULL_FLOW_TOKENS;
  private readonly globalCap =
    Number(process.env.GLOBAL_DAILY_TOKEN_CAP) || 10_000_000;

  constructor(private readonly prisma: PrismaService) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Reserve `tokens` for an AI operation by `kind`. Atomically increments the
   * per-user and global day counters, then throws 429 (and refunds) if either
   * cap is exceeded. Call immediately BEFORE the real AI call (not on cache
   * hits). Atomic increments make this safe across concurrent requests.
   */
  async consume(userId: string, kind: GenKind): Promise<void> {
    const tokens = TOKEN_COST[kind];
    const day = this.today();

    const [u, g] = await this.prisma.$transaction([
      this.prisma.usageCounter.upsert({
        where: { userId_day: { userId, day } },
        create: { userId, day, tokens },
        update: { tokens: { increment: tokens } },
        select: { tokens: true },
      }),
      this.prisma.usageCounter.upsert({
        where: { userId_day: { userId: GLOBAL_KEY, day } },
        create: { userId: GLOBAL_KEY, day, tokens },
        update: { tokens: { increment: tokens } },
        select: { tokens: true },
      }),
    ]);

    const overGlobal = g.tokens > this.globalCap;
    const overUser = u.tokens > this.userCap;
    if (overGlobal || overUser) {
      // Refund this reservation so a rejected call doesn't burn budget.
      await this.prisma
        .$transaction([
          this.prisma.usageCounter.update({
            where: { userId_day: { userId, day } },
            data: { tokens: { decrement: tokens } },
          }),
          this.prisma.usageCounter.update({
            where: { userId_day: { userId: GLOBAL_KEY, day } },
            data: { tokens: { decrement: tokens } },
          }),
        ])
        .catch(() => undefined);

      if (overGlobal) {
        this.log.warn(`Global daily token cap (${this.globalCap}) reached`);
        throw new HttpException(
          'The service has reached today’s capacity. Please try again tomorrow.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        'You’ve used today’s free AI budget. It resets at midnight (UTC).',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Read the remaining token budget for a user (no consumption). */
  async status(userId: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
    fullFlow: number;
  }> {
    const row = await this.prisma.usageCounter.findUnique({
      where: { userId_day: { userId, day: this.today() } },
      select: { tokens: true },
    });
    const used = row?.tokens ?? 0;
    return {
      used,
      limit: this.userCap,
      remaining: Math.max(0, this.userCap - used),
      fullFlow: FULL_FLOW_TOKENS,
    };
  }
}
