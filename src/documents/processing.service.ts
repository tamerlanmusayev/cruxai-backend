import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ProcessDocumentMachine } from './machines/process-document.machine';

export const PROCESS_QUEUE = 'process-document';

interface ProcessJob {
  documentId: string;
}

/**
 * Background worker for document ingest. The actual pipeline is modeled as an
 * XState machine (process-document.machine.ts); this service just pulls jobs
 * off the pg-boss queue, runs the machine, and notifies the user on success.
 */
@Injectable()
export class ProcessingService implements OnModuleInit {
  private readonly log = new Logger(ProcessingService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly realtime: RealtimeGateway,
    private readonly machine: ProcessDocumentMachine,
  ) {}

  async onModuleInit() {
    await this.queue.work<ProcessJob>(PROCESS_QUEUE, (d) => this.run(d.documentId));
  }

  async run(documentId: string): Promise<void> {
    const out = await this.machine.run(documentId);
    if (out.ok && out.userId && out.title) {
      this.realtime.notifyDocReady(out.userId, { id: documentId, title: out.title });
    }
    if (!out.ok) {
      // Surface to pg-boss so the job is recorded failed / retried.
      throw new Error(out.error ?? 'Processing failed');
    }
  }
}
