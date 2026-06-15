import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { friendlyError } from './friendly-error.util';
import {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  SUPPORTED_EXTENSIONS,
  extOf,
} from './extract.util';
import { Prisma } from '@prisma/client';
import { UpdateSummaryDto } from './dto/update-summary.dto';
import { CreateDocumentDto, RequestUploadsDto } from './dto/upload.dto';
import { PROCESS_QUEUE } from './processing.service';

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  /** Create a document from an AI-generated overview of a (copyrighted) book. */
  async createOverview(title: string, lang: string | undefined, userId?: string) {
    const language = ['az', 'ru', 'en', 'tr', 'kk', 'uz', 'ka'].includes(lang ?? '')
      ? lang
      : undefined;
    const doc = await this.prisma.document.create({
      data: { title: title.slice(0, 200) || 'Book', status: 'PROCESSING', userId, language },
      select: { id: true, title: true, status: true, createdAt: true },
    });
    try {
      const ov = await this.ai.bookOverview(title, language);
      await this.prisma.summary.create({
        data: { documentId: doc.id, contentMd: ov.contentMd, keyPoints: ov.keyPoints },
      });
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'READY', language: ov.language },
      });
    } catch (e) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'FAILED', error: friendlyError(String((e as Error)?.message ?? e)) },
      });
    }
    return doc;
  }

  /** Validate a batch and hand back presigned PUT URLs (one per file). */
  async requestUploads(dto: RequestUploadsDto) {
    const total = dto.files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      const mb = (total / 1024 / 1024).toFixed(1);
      throw new ForbiddenException(
        `Total size ${mb} MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024} MB limit.`,
      );
    }
    const uploads = await Promise.all(
      dto.files.map(async (f) => {
        if (!SUPPORTED_EXTENSIONS.includes(extOf(f.name))) {
          throw new ForbiddenException(
            `"${f.name}": unsupported format. Use PDF, DOCX, TXT or MD.`,
          );
        }
        const key = this.storage.newKey(f.name);
        const url = await this.storage.presignPut(
          key,
          f.type ?? 'application/octet-stream',
        );
        return { name: f.name, key, url };
      }),
    );
    return { uploads };
  }

  /** Create a document from uploaded keys and queue it for processing. */
  async create(dto: CreateDocumentDto, userId?: string) {
    if (dto.sources.length > MAX_FILES) {
      throw new ForbiddenException(`Too many files (max ${MAX_FILES}).`);
    }
    const language = ['az', 'ru', 'en', 'tr', 'kk', 'uz', 'ka'].includes(dto.lang ?? '')
      ? dto.lang
      : undefined;
    const first = dto.sources[0].name.replace(/\.[a-z0-9]+$/i, '');
    const title =
      dto.sources.length === 1
        ? first
        : `${first} +${dto.sources.length - 1} more`;

    const doc = await this.prisma.document.create({
      data: {
        title: (title || 'Untitled').slice(0, 200),
        status: 'QUEUED',
        userId,
        language,
        sources: dto.sources as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, title: true, status: true, createdAt: true },
    });

    await this.queue.enqueue(PROCESS_QUEUE, { documentId: doc.id });
    this.log.log(`Document ${doc.id} queued (${dto.sources.length} file(s))`);
    return doc;
  }

  /** A user's library — most recent first, paginated. */
  async listForUser(userId: string, skip = 0, take = 10) {
    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
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

  /** Owner-only delete. Cascades remove summary/chunks/quizzes/flashcards/
   * concepts (and their attempts/reviews/masteries) — so the doc disappears
   * from library, review, progress and synthesis. Exams have no FK, so we
   * clear them explicitly. */
  async remove(id: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.userId && doc.userId !== userId) {
      throw new ForbiddenException('Not your document');
    }
    await this.prisma.exam.deleteMany({ where: { documentId: id } });
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
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
