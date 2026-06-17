import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UsageService } from '../usage/usage.service';
import { sm2 } from './sm2';

@Injectable()
export class FlashcardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly usage: UsageService,
  ) {}

  /** Generate the deck for a document the user owns; return existing otherwise. */
  async generateOrGet(documentId: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const existing = await this.prisma.flashcard.findMany({
      where: { documentId },
      select: { id: true, front: true, back: true, difficulty: true },
    });
    if (existing.length) return existing;

    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    // Generate from the (short) summary, not the full text — far cheaper.
    const summary = await this.prisma.summary.findUnique({
      where: { documentId },
      select: { contentMd: true },
    });
    await this.usage.reserve(userId, 'flashcards');
    const drafts = await this.ai.makeFlashcards(
      doc.title,
      summary?.contentMd ?? doc.text,
      doc.language ?? 'en',
      userId,
    );
    await this.prisma.flashcard.createMany({
      data: drafts.map((d) => ({
        documentId,
        front: d.front,
        back: d.back,
        difficulty: d.difficulty,
      })),
    });
    return this.prisma.flashcard.findMany({
      where: { documentId },
      select: { id: true, front: true, back: true, difficulty: true },
    });
  }

  /** Cards due for review for this user (new cards + scheduled-due cards). */
  async due(userId: string, limit = 20) {
    const cards = await this.prisma.flashcard.findMany({
      where: {
        document: { userId },
        OR: [
          { reviews: { none: { userId } } },
          { reviews: { some: { userId, dueAt: { lte: new Date() } } } },
        ],
      },
      take: limit,
      select: { id: true, front: true, back: true, difficulty: true },
    });
    return cards;
  }

  /** Apply an SM-2 review grade (0–5) and reschedule. */
  async review(userId: string, flashcardId: string, grade: number) {
    const card = await this.prisma.flashcard.findUnique({
      where: { id: flashcardId },
      select: { id: true },
    });
    if (!card) throw new NotFoundException('Flashcard not found');

    const prev = await this.prisma.flashcardReview.findUnique({
      where: { userId_flashcardId: { userId, flashcardId } },
    });

    const next = sm2(
      {
        easeFactor: prev?.easeFactor ?? 2.5,
        intervalDays: prev?.intervalDays ?? 0,
        repetitions: prev?.repetitions ?? 0,
      },
      grade,
      new Date(),
    );

    await this.prisma.flashcardReview.upsert({
      where: { userId_flashcardId: { userId, flashcardId } },
      create: {
        userId,
        flashcardId,
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        dueAt: next.dueAt,
        lastGrade: grade,
      },
      update: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        dueAt: next.dueAt,
        lastGrade: grade,
      },
    });

    return { dueAt: next.dueAt, intervalDays: next.intervalDays };
  }
}
