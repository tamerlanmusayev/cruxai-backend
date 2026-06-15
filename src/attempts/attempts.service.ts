import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { MasteryService } from '../progress/mastery.service';
import { QuizQuestion } from '../ai/ai.types';
import { UsageService } from '../usage/usage.service';

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly mastery: MasteryService,
    private readonly usage: UsageService,
  ) {}

  async submit(quizId: string, answers: number[], userId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { document: { select: { id: true, language: true, userId: true } } },
    });
    if (!quiz || quiz.document.userId !== userId) {
      throw new NotFoundException('Quiz not found');
    }

    const questions = quiz.questions as unknown as QuizQuestion[];

    // Authoritative score, computed server-side.
    const score = questions.reduce(
      (acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0),
      0,
    );

    this.usage.consume(userId, 'grade');
    const grade = await this.ai.grade(
      questions,
      answers,
      quiz.document.language ?? 'en',
    );

    const attempt = await this.prisma.attempt.create({
      data: {
        quizId,
        userId,
        answers,
        score,
        total: questions.length,
        feedback: grade.feedback as unknown as Prisma.InputJsonValue,
      },
    });

    // Adaptive loop: update per-concept mastery for signed-in users.
    if (userId) {
      await this.mastery.updateFromAttempt(
        userId,
        quiz.document.id,
        questions,
        answers,
      );
    }

    return {
      id: attempt.id,
      score,
      total: questions.length,
      feedback: grade.feedback,
    };
  }
}
