import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MasteryService } from '../progress/mastery.service';
import { QuizQuestion } from '../ai/ai.types';
import { UsageService } from '../usage/usage.service';

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly mastery: MasteryService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Returns a quiz for the document.
   * - `fresh=false` (page load): reuse the latest cached quiz — no AI cost.
   * - `fresh=true` (explicit "refresh"): regenerate, focused on weak concepts.
   * Questions are generated from the SUMMARY (cheap) rather than the full text.
   */
  async generateOrGet(documentId: string, userId: string, fresh = false) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    if (!fresh) {
      const cached = await this.prisma.quiz.findFirst({
        where: { documentId },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) return this.sanitize(cached.id, cached.questions, cached.adaptive);
    }

    const weak = fresh ? await this.mastery.weakConcepts(userId, documentId) : [];
    const source = await this.sourceText(documentId, doc.text);

    await this.usage.reserve(userId, 'quiz');
    const questions = await this.ai.makeQuiz(
      doc.title,
      source,
      doc.language ?? 'en',
      5,
      weak,
      userId,
    );
    const quiz = await this.prisma.quiz.create({
      data: {
        documentId,
        adaptive: weak.length > 0,
        questions: questions as unknown as Prisma.InputJsonValue,
      },
    });
    return this.sanitize(quiz.id, questions, weak.length > 0, weak);
  }

  /** Generate from the (short) summary instead of the full document text. */
  private async sourceText(documentId: string, fallback: string): Promise<string> {
    const summary = await this.prisma.summary.findUnique({
      where: { documentId },
      select: { contentMd: true, keyPoints: true },
    });
    if (!summary) return fallback;
    const points = Array.isArray(summary.keyPoints)
      ? (summary.keyPoints as string[]).join('\n')
      : '';
    return `${summary.contentMd}\n\nKey points:\n${points}`;
  }

  private sanitize(
    id: string,
    questions: unknown,
    adaptive: boolean,
    focusedOn: string[] = [],
  ) {
    const list = questions as QuizQuestion[];
    return {
      id,
      adaptive,
      focusedOn,
      questions: list.map((q) => ({ question: q.question, options: q.options })),
    };
  }
}
