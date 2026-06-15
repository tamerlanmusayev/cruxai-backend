import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

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

/**
 * In-memory daily AI-token budget to protect against runaway spend.
 * Per-user cap defaults to 3× a full flow (~3 documents/day); the global cap
 * is a kill-switch for the whole platform. Counters reset at UTC midnight.
 * (In-memory is intentional — a safety cap, not billing-grade accounting;
 * resets on restart, which is acceptable for a cost guard.)
 */
@Injectable()
export class UsageService {
  private readonly log = new Logger(UsageService.name);
  private readonly userCap =
    Number(process.env.USER_DAILY_TOKEN_CAP) || 3 * FULL_FLOW_TOKENS;
  private readonly globalCap =
    Number(process.env.GLOBAL_DAILY_TOKEN_CAP) || 10_000_000;

  private day = '';
  private global = 0;
  private perUser = new Map<string, number>();

  private roll(today: string) {
    if (today !== this.day) {
      this.day = today;
      this.global = 0;
      this.perUser.clear();
    }
  }

  /**
   * Reserve `tokens` for an AI operation by `kind`. Throws 429 if it would
   * blow the per-user or global daily budget; otherwise records the spend.
   * Call this immediately BEFORE the actual AI call (only when it really runs,
   * i.e. not on cache hits).
   */
  consume(userId: string, kind: GenKind): void {
    const tokens = TOKEN_COST[kind];
    this.roll(new Date().toISOString().slice(0, 10));

    if (this.global + tokens > this.globalCap) {
      this.log.warn(`Global daily token cap (${this.globalCap}) reached`);
      throw new HttpException(
        'The service has reached today’s capacity. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const used = this.perUser.get(userId) ?? 0;
    if (used + tokens > this.userCap) {
      throw new HttpException(
        'You’ve used today’s free AI budget. It resets at midnight (UTC).',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.global += tokens;
    this.perUser.set(userId, used + tokens);
  }

  /** Read the remaining token budget for a user (no consumption). */
  status(userId: string): {
    used: number;
    limit: number;
    remaining: number;
    fullFlow: number;
  } {
    this.roll(new Date().toISOString().slice(0, 10));
    const used = this.perUser.get(userId) ?? 0;
    return {
      used,
      limit: this.userCap,
      remaining: Math.max(0, this.userCap - used),
      fullFlow: FULL_FLOW_TOKENS,
    };
  }
}
