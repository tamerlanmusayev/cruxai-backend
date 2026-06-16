import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

/**
 * Seeds a handful of curated, public sample documents so a first-time visitor
 * sees real value (a full AI summary) without uploading or signing in. They are
 * flagged `isExample` → shown on the home page, excluded from user libraries and
 * public stats. Idempotent: skips titles already seeded.
 *
 * Run after a real ANTHROPIC_API_KEY is configured:
 *   npm run build && npm run seed:examples
 */
const EXAMPLES: { title: string; lang: string }[] = [
  { title: 'Sapiens: A Brief History of Humankind', lang: 'en' },
  { title: 'Atomic Habits', lang: 'en' },
  { title: 'Преступление и наказание', lang: 'ru' },
  { title: 'Əli və Nino', lang: 'az' },
];

async function main() {
  const log = new Logger('seed-examples');

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY is not set — cannot generate examples. Aborting.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const ai = app.get(AiService);

  // A single system account owns every example document.
  const owner = await prisma.user.upsert({
    where: { email: 'examples@cruxai.local' },
    update: {},
    create: { email: 'examples@cruxai.local', name: 'CruxAI Examples' },
    select: { id: true },
  });

  let created = 0;
  for (const ex of EXAMPLES) {
    const exists = await prisma.document.findFirst({
      where: { isExample: true, title: ex.title },
      select: { id: true },
    });
    if (exists) {
      log.log(`skip (already seeded): ${ex.title}`);
      continue;
    }

    log.log(`generating: ${ex.title} (${ex.lang})…`);
    try {
      const ov = await ai.bookOverview(ex.title, ex.lang);
      const doc = await prisma.document.create({
        data: {
          title: ex.title,
          language: ov.language ?? ex.lang,
          status: 'READY',
          isExample: true,
          userId: owner.id,
        },
        select: { id: true },
      });
      await prisma.summary.create({
        data: {
          documentId: doc.id,
          contentMd: ov.contentMd,
          keyPoints: ov.keyPoints as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;
      log.log(`  ✓ ${ex.title} → /doc/${doc.id}`);
    } catch (e) {
      log.error(`  ✗ ${ex.title}: ${(e as Error).message}`);
    }
  }

  log.log(`Done. ${created} new example(s) created.`);
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
