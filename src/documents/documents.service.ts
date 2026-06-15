import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { extractFiles, IncomingFile } from './extract.util';
import { chunkText } from './chunk.util';
import { Prisma } from '@prisma/client';
import { UpdateSummaryDto } from './dto/update-summary.dto';

/** Map raw provider/internal errors to a clean, user-facing message. */
function friendlyError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('credit balance') || s.includes('billing') || s.includes('quota')) {
    return 'AI is temporarily unavailable (service capacity). Please try again later.';
  }
  if (s.includes('401') || s.includes('authentication') || s.includes('api key')) {
    return 'AI service is not configured right now. Please try again later.';
  }
  if (s.includes('429') || s.includes('rate limit') || s.includes('overloaded')) {
    return 'The AI is busy right now — please try again in a minute.';
  }
  if (s.startsWith('4') && s.includes('{')) {
    // Any other raw HTTP/JSON provider error — don't leak internals.
    return 'Something went wrong while processing this document. Please try again.';
  }
  // Our own validation messages (page limit, scanned, etc.) are already friendly.
  return raw.slice(0, 300);
}

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** Extract text from one or more files, store, and summarize in background. */
  async createFromFiles(files: IncomingFile[], lang?: string, userId?: string) {
    const { title, text, skipped } = await extractFiles(files);

    const doc = await this.prisma.document.create({
      data: {
        title,
        text,
        status: 'PROCESSING',
        userId,
        skipped: skipped.length
          ? (skipped as unknown as Prisma.InputJsonValue)
          : undefined,
      },
      select: { id: true, title: true, status: true, createdAt: true },
    });

    // Fire-and-forget: client polls GET /documents/:id for status.
    void this.process(doc.id, title, text, lang);

    return { ...doc, skipped };
  }

  private async process(
    id: string,
    title: string,
    text: string,
    lang?: string,
  ) {
    try {
      const chunks = chunkText(text);
      const summary = await this.ai.summarize(title, chunks, lang);
      await this.prisma.$transaction([
        this.prisma.chunk.createMany({
          data: chunks.map((c) => ({
            documentId: id,
            ordinal: c.ordinal,
            section: c.section,
            text: c.text,
          })),
        }),
        this.prisma.summary.create({
          data: {
            documentId: id,
            contentMd: summary.contentMd,
            keyPoints: summary.keyPoints,
            citations: summary.citations as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.document.update({
          where: { id },
          data: { status: 'READY', language: summary.language },
        }),
      ]);
      this.log.log(
        `Document ${id} summarized (${summary.language}, ${chunks.length} chunks)`,
      );
    } catch (err) {
      const raw = String((err as Error)?.message ?? err);
      this.log.error(`Document ${id} failed: ${raw}`);
      try {
        await this.prisma.document.update({
          where: { id },
          data: { status: 'FAILED', error: friendlyError(raw) },
        });
      } catch (e) {
        this.log.error(`Could not mark ${id} FAILED: ${e}`);
      }
    }
  }

  /** A user's library — most recent first. */
  async listForUser(userId: string) {
    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        language: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        language: true,
        error: true,
        skipped: true,
        createdAt: true,
        // NOTE: never return `text` (the full source) or `userId` to clients.
        summary: {
          select: { contentMd: true, keyPoints: true, citations: true },
        },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /** Owner-only inline edits to the generated summary (no AI cost). */
  async updateSummary(id: string, userId: string, dto: UpdateSummaryDto) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { userId: true, summary: { select: { id: true } } },
    });
    if (!doc || !doc.summary) throw new NotFoundException('Document not found');
    if (doc.userId && doc.userId !== userId) {
      throw new ForbiddenException('Not your document');
    }
    await this.prisma.summary.update({
      where: { documentId: id },
      data: {
        contentMd: dto.contentMd,
        keyPoints:
          dto.keyPoints === undefined
            ? undefined
            : (dto.keyPoints as unknown as Prisma.InputJsonValue),
      },
    });
    return this.findOne(id);
  }
}
