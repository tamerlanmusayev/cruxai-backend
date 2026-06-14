import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { DocumentsModule } from './documents/documents.module';
import { QuizModule } from './quiz/quiz.module';
import { AttemptsModule } from './attempts/attempts.module';
import { FlashcardsModule } from './flashcards/flashcards.module';
import { ConceptsModule } from './concepts/concepts.module';
import { ExamsModule } from './exams/exams.module';
import { SynthesisModule } from './synthesis/synthesis.module';
import { AudioModule } from './audio/audio.module';
import { ProgressModule } from './progress/progress.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    // Global rate limit: 30 requests / minute / IP (stricter on uploads).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    PrismaModule,
    AuthModule,
    AiModule,
    DocumentsModule,
    QuizModule,
    AttemptsModule,
    FlashcardsModule,
    ConceptsModule,
    ExamsModule,
    SynthesisModule,
    AudioModule,
    ProgressModule,
    StatsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
