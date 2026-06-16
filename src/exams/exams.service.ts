import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { QuizQuestion } from '../ai/ai.types';
import { UsageService } from '../usage/usage.service';

const EXAM_QUESTIONS = 10;
const SECONDS_PER_QUESTION = 60;

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Timed exam for a document the user owns.
   * - `fresh=false` (page load): reuse the latest not-yet-submitted exam — no AI cost.
   * - `fresh=true` ("new exam"): generate a new one. Generated from the SUMMARY.
   */
  async create(documentId: string, userId: string, fresh = false) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    if (!fresh) {
      const existing = await this.prisma.exam.findFirst({
        where: { documentId, userId, score: null },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const qs = existing.questions as unknown as QuizQuestion[];
        return {
          id: existing.id,
          durationSec: existing.durationSec,
          questions: qs.map((q) => ({ question: q.question, options: q.options })),
        };
      }
    }

    const source = await this.sourceText(documentId, doc.text);
    await this.usage.consume(userId, 'exam');
    const questions = await this.ai.makeQuiz(
      doc.title,
      source,
      doc.language ?? 'en',
      EXAM_QUESTIONS,
    );

    const exam = await this.prisma.exam.create({
      data: {
        userId,
        documentId,
        durationSec: questions.length * SECONDS_PER_QUESTION,
        total: questions.length,
        questions: questions as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      id: exam.id,
      durationSec: exam.durationSec,
      questions: questions.map((q) => ({
        question: q.question,
        options: q.options,
      })),
    };
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

  /** Grade an exam submission, store score + weak-area report. */
  async submit(examId: string, userId: string, answers: number[]) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.userId !== userId) {
      throw new NotFoundException('Exam not found');
    }
    const questions = exam.questions as unknown as QuizQuestion[];

    let score = 0;
    const weak: { question: string; explanation: string }[] = [];
    questions.forEach((q, i) => {
      if (answers[i] === q.correctIndex) score += 1;
      else weak.push({ question: q.question, explanation: q.explanation });
    });

    await this.prisma.exam.update({
      where: { id: examId },
      data: { score, weakReport: weak as unknown as Prisma.InputJsonValue },
    });

    return {
      score,
      total: questions.length,
      predicted: Math.round((score / questions.length) * 100),
      weakReport: weak,
      answers: questions.map((q, i) => ({
        correctIndex: q.correctIndex,
        chosenIndex: answers[i] ?? -1,
        explanation: q.explanation,
      })),
    };
  }
}
