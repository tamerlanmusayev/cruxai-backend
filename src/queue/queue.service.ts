import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import PgBoss from 'pg-boss';

/**
 * Durable background job queue backed by the same PostgreSQL database
 * (pg-boss manages its own `pgboss` schema). Jobs survive restarts and are
 * retried on failure, unlike fire-and-forget in-process work.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QueueService.name);
  private readonly boss = new PgBoss(process.env.DATABASE_URL ?? '');
  private started = false;

  async onModuleInit() {
    this.boss.on('error', (e) => this.log.error(`pg-boss: ${e.message}`));
    await this.boss.start();
    this.started = true;
    this.log.log('pg-boss started');
  }

  async onModuleDestroy() {
    if (this.started) await this.boss.stop({ graceful: true });
  }

  /** Enqueue a job. Returns the job id (null if pg-boss dedupes/drops it). */
  async enqueue<T extends object>(queue: string, data: T): Promise<string | null> {
    return this.boss.send(queue, data, { retryLimit: 2, retryDelay: 30 });
  }

  /** Register a worker for a queue. Handler runs once per job. */
  async work<T extends object>(
    queue: string,
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    await this.boss.work<T>(queue, async (job) => {
      await handler(job.data);
    });
    this.log.log(`worker listening: ${queue}`);
  }
}
