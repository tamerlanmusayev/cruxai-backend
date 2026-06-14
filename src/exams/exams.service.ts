import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { QuizQuestion } from '../ai/ai.types';

const EXAM_QUESTIONS = 10;
const SECONDS_PER_QUESTION = 60;

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** Build a fresh timed exam for a document the user owns. */
  async create(documentId: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    const questions = await this.ai.makeQuiz(
      doc.title,
      doc.text,
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
