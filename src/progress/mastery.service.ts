import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuizQuestion } from '../ai/ai.types';

const ALPHA = 0.4; // EWMA weight for the latest result

@Injectable()
export class MasteryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Find or create the concept for a (document, name) pair. */
  private async conceptId(documentId: string, name: string): Promise<string> {
    const clean = name.trim().slice(0, 80) || 'General';
    const existing = await this.prisma.concept.findFirst({
      where: { documentId, name: clean },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.concept.create({
      data: { documentId, name: clean, summary: '' },
      select: { id: true },
    });
    return created.id;
  }

  /** Update per-concept mastery from a graded attempt. */
  async updateFromAttempt(
    userId: string,
    documentId: string,
    questions: QuizQuestion[],
    answers: number[],
  ): Promise<void> {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.concept) continue;
      const correct = answers[i] === q.correctIndex ? 1 : 0;
      const conceptId = await this.conceptId(documentId, q.concept);

      const prev = await this.prisma.userConcept.findUnique({
        where: { userId_conceptId: { userId, conceptId } },
      });
      const mastery = prev
        ? prev.mastery * (1 - ALPHA) + correct * ALPHA
        : correct * ALPHA;

      await this.prisma.userConcept.upsert({
        where: { userId_conceptId: { userId, conceptId } },
        create: {
          userId,
          conceptId,
          mastery,
          seen: 1,
          correct,
        },
        update: {
          mastery,
          seen: { increment: 1 },
          correct: { increment: correct },
        },
      });
    }
  }

  /** Names of the user's weakest concepts for a document. */
  async weakConcepts(
    userId: string,
    documentId: string,
    limit = 4,
  ): Promise<string[]> {
    const rows = await this.prisma.userConcept.findMany({
      where: { userId, mastery: { lt: 0.6 }, concept: { documentId } },
      orderBy: { mastery: 'asc' },
      take: limit,
      include: { concept: { select: { name: true } } },
    });
    return rows.map((r) => r.concept.name);
  }

  /** Full mastery breakdown for the user. */
  async progress(userId: string) {
    const rows = await this.prisma.userConcept.findMany({
      where: { userId },
      orderBy: { mastery: 'asc' },
      include: {
        concept: { select: { name: true, documentId: true } },
      },
    });
    return rows.map((r) => ({
      concept: r.concept.name,
      documentId: r.concept.documentId,
      mastery: Math.round(r.mastery * 100) / 100,
      seen: r.seen,
      correct: r.correct,
    }));
  }
}
