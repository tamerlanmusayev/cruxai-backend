import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { extractFiles, IncomingFile } from './extract.util';
import { chunkText } from './chunk.util';
import { friendlyError } from './friendly-error.util';

export const PROCESS_QUEUE = 'process-document';

interface ProcessJob {
  documentId: string;
}

interface SourceRef {
  key: string;
  name: string;
}

/**
 * Background worker: fetches the uploaded objects, extracts their text,
 * summarizes with Claude, and persists chunks + summary. Runs off the
 * pg-boss queue so it survives restarts and retries on transient failure.
 */
@Injectable()
export class ProcessingService implements OnModuleInit {
  private readonly log = new Logger(ProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit() {
    await this.queue.work<ProcessJob>(PROCESS_QUEUE, (d) => this.run(d.documentId));
  }

  async run(documentId: string): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, sources: true, language: true, status: true },
    });
    if (!doc) {
      this.log.warn(`Document ${documentId} vanished before processing`);
      return;
    }
    if (doc.status === 'READY') return; // already done (retry after success)

    const sources = (doc.sources as unknown as SourceRef[] | null) ?? [];
    if (!sources.length) {
      await this.fail(documentId, 'No source files were uploaded.');
      return;
    }

    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'PROCESSING' },
      });

      // Pull the uploaded bytes back from storage into the extractor's shape.
      const files: IncomingFile[] = await Promise.all(
        sources.map(async (s) => {
          const buffer = await this.storage.get(s.key);
          return {
            originalname: s.name,
            mimetype: '',
            buffer,
            size: buffer.length,
          };
        }),
      );

      const { title, text, skipped } = await extractFiles(files);
      const chunks = chunkText(text);
      const lang = doc.language ?? undefined;
      const summary = await this.ai.summarize(title, chunks, lang);

      await this.prisma.$transaction([
        this.prisma.chunk.createMany({
          data: chunks.map((c) => ({
            documentId,
            ordinal: c.ordinal,
            section: c.section,
            text: c.text,
          })),
        }),
        this.prisma.summary.create({
          data: {
            documentId,
            contentMd: summary.contentMd,
            keyPoints: summary.keyPoints,
            citations: summary.citations as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.document.update({
          where: { id: documentId },
          data: {
            status: 'READY',
            title,
            text,
            language: summary.language,
            skipped: skipped.length
              ? (skipped as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        }),
      ]);
      this.log.log(
        `Document ${documentId} summarized (${summary.language}, ${chunks.length} chunks)`,
      );
    } catch (err) {
      const raw = String((err as Error)?.message ?? err);
      this.log.error(`Document ${documentId} failed: ${raw}`);
      await this.fail(documentId, friendlyError(raw));
      throw err; // let pg-boss record the failure / retry
    }
  }

  private async fail(documentId: string, message: string) {
    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', error: message },
      });
    } catch (e) {
      this.log.error(`Could not mark ${documentId} FAILED: ${e}`);
    }
  }
}
