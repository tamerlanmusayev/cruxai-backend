import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

/**
 * In-memory daily generation limiter to protect against runaway AI spend.
 * Per-user cap stops one visitor burning the budget; the global cap is a
 * kill-switch for the whole platform. Counters reset at UTC midnight.
 * (In-memory is intentional — a safety cap, not billing-grade accounting;
 * resets on restart, which is acceptable for a cost guard.)
 */
@Injectable()
export class UsageService {
  private readonly log = new Logger(UsageService.name);
  private readonly userCap = Number(process.env.USER_DAILY_GEN_CAP) || 20;
  private readonly globalCap = Number(process.env.GLOBAL_DAILY_GEN_CAP) || 1000;

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

  /** Count one AI generation for this user; throws 429 if a cap is hit. */
  consume(userId: string): void {
    const today = new Date().toISOString().slice(0, 10);
    this.roll(today);

    if (this.global >= this.globalCap) {
      this.log.warn(`Global daily generation cap (${this.globalCap}) reached`);
      throw new HttpException(
        'The service has reached today’s capacity. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const used = this.perUser.get(userId) ?? 0;
    if (used >= this.userCap) {
      throw new HttpException(
        `Daily limit reached (${this.userCap} per day). Please come back tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.global += 1;
    this.perUser.set(userId, used + 1);
  }
}
