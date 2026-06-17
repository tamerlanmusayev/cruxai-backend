import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Read a positive integer cost from env, falling back to the default. */
const cost = (key: string, def: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

/**
 * Estimated token cost (input + output, rounded) of each AI operation.
 * Deliberate over-estimates for an internal budget (a cost guard, not exact
 * Anthropic billing). Each is overridable via env `TOKEN_COST_<KIND>`.
 */
export const TOKEN_COST = {
  summary: cost('TOKEN_COST_SUMMARY', 40_000), // upload → summarize (the heavy one)
  overview: cost('TOKEN_COST_OVERVIEW', 6_000), // AI overview of a copyrighted book
  quiz: cost('TOKEN_COST_QUIZ', 12_000), // generate / refresh a quiz
  flashcards: cost('TOKEN_COST_FLASHCARDS', 8_000), // flashcard deck
  graph: cost('TOKEN_COST_GRAPH', 8_000), // knowledge graph
  exam: cost('TOKEN_COST_EXAM', 12_000), // timed exam
  synthesis: cost('TOKEN_COST_SYNTHESIS', 12_000), // compare 2–5 documents
  grade: cost('TOKEN_COST_GRADE', 4_000), // grade a quiz attempt
  recommend: cost('TOKEN_COST_RECOMMEND', 4_000), // AI reading list
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
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface WindowRow {
  tokens: number;
  windowStart: Date;
}

/**
 * AI-token budget as a ROLLING 24h window per user, persisted in Postgres
 * (`UsageWindow`) so it survives restarts and is shared across API instances.
 * The window starts on the user's first spend and resets exactly 24h later —
 * each user has their own reset clock (not a shared UTC midnight). A
 * '__global__' row is the platform-wide rolling kill-switch.
 */
@Injectable()
export class UsageService implements OnModuleInit {
  private readonly log = new Logger(UsageService.name);
  private readonly userCap =
    Number(process.env.USER_DAILY_TOKEN_CAP) || 3 * FULL_FLOW_TOKENS;
  private readonly globalCap =
    Number(process.env.GLOBAL_DAILY_TOKEN_CAP) || 10_000_000;
  private static readonly KEEP_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  /** Prune windows untouched for KEEP_DAYS on boot, then once a day. */
  onModuleInit(): void {
    void this.pruneOld();
    const timer = setInterval(() => void this.pruneOld(), WINDOW_MS);
    timer.unref?.(); // don't keep the process alive just for cleanup
  }

  private async pruneOld(): Promise<void> {
    const cutoff = new Date(Date.now() - UsageService.KEEP_DAYS * WINDOW_MS);
    try {
      const { count } = await this.prisma.usageWindow.deleteMany({
        where: { windowStart: { lt: cutoff } },
      });
      if (count) this.log.log(`Pruned ${count} stale usage window(s)`);
    } catch (e) {
      this.log.warn(`Usage prune failed: ${(e as Error).message}`);
    }
  }

  /**
   * Add `tokens` to a rolling window in one atomic statement: if the existing
   * window is older than 24h it restarts at now() with just these tokens,
   * otherwise it increments. Returns the resulting total + window start.
   */
  private async bump(userId: string, tokens: number): Promise<WindowRow> {
    const rows = await this.prisma.$queryRaw<WindowRow[]>`
      INSERT INTO "UsageWindow" ("userId", "windowStart", "tokens")
      VALUES (${userId}, now(), ${tokens})
      ON CONFLICT ("userId") DO UPDATE SET
        "windowStart" = CASE
          WHEN "UsageWindow"."windowStart" < now() - interval '24 hours'
          THEN now() ELSE "UsageWindow"."windowStart" END,
        "tokens" = CASE
          WHEN "UsageWindow"."windowStart" < now() - interval '24 hours'
          THEN ${tokens} ELSE "UsageWindow"."tokens" + ${tokens} END
      RETURNING "tokens", "windowStart";`;
    return rows[0];
  }

  /** Public config: per-operation token estimates + one full-flow total. */
  config(): { costs: Record<GenKind, number>; fullFlow: number; userLimit: number } {
    return { costs: { ...TOKEN_COST }, fullFlow: FULL_FLOW_TOKENS, userLimit: this.userCap };
  }

  private async refund(userId: string, tokens: number): Promise<void> {
    await this.prisma.usageWindow
      .update({ where: { userId }, data: { tokens: { decrement: tokens } } })
      .catch(() => undefined);
  }

  /**
   * Reserve `tokens` for an AI operation by `kind`. Bumps the per-user and
   * global rolling windows, then throws 429 (and refunds) if either cap is
   * exceeded. Call immediately BEFORE the real AI call (not on cache hits).
   */
  async consume(userId: string, kind: GenKind): Promise<void> {
    const tokens = TOKEN_COST[kind];
    const u = await this.bump(userId, tokens);
    const g = await this.bump(GLOBAL_KEY, tokens);

    const overGlobal = g.tokens > this.globalCap;
    const overUser = u.tokens > this.userCap;
    if (overGlobal || overUser) {
      await this.refund(userId, tokens);
      await this.refund(GLOBAL_KEY, tokens);

      if (overGlobal) {
        this.log.warn(`Global daily token cap (${this.globalCap}) reached`);
        throw new HttpException(
          'The service has reached today’s capacity. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        'You’ve used your free AI budget. It refills 24h after you started.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Remaining token budget for a user (no consumption). `resetsAt` is when the
   * current window refills (null if the user hasn't spent anything yet, or the
   * previous window already lapsed → full budget available now).
   */
  async status(userId: string): Promise<{
    used: number;
    limit: number;
    remaining: number;
    fullFlow: number;
    resetsAt: string | null;
  }> {
    const row = await this.prisma.usageWindow.findUnique({ where: { userId } });
    const active = row && Date.now() - row.windowStart.getTime() < WINDOW_MS;
    const used = active ? row!.tokens : 0;
    return {
      used,
      limit: this.userCap,
      remaining: Math.max(0, this.userCap - used),
      fullFlow: FULL_FLOW_TOKENS,
      resetsAt: active
        ? new Date(row!.windowStart.getTime() + WINDOW_MS).toISOString()
        : null,
    };
  }
}
