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

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly mastery: MasteryService,
  ) {}

  /**
   * Returns a quiz for the document. For a signed-in user with prior results,
   * generates a fresh ADAPTIVE quiz focused on their weak concepts; otherwise
   * reuses the latest cached quiz (or creates a base one).
   */
  async generateOrGet(documentId: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    const weak = await this.mastery.weakConcepts(userId, documentId);

    if (!weak.length) {
      // No adaptive signal yet — reuse the latest cached quiz if present.
      const cached = await this.prisma.quiz.findFirst({
        where: { documentId, adaptive: false },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) {
        return this.sanitize(cached.id, cached.questions, false);
      }
    }

    const questions = await this.ai.makeQuiz(
      doc.title,
      doc.text,
      doc.language ?? 'en',
      5,
      weak,
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

  /** Strip answers/explanations before sending to the client. */
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
      questions: list.map((q) => ({
        question: q.question,
        options: q.options,
      })),
    };
  }
}
