import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UsageService } from '../usage/usage.service';

@Injectable()
export class SynthesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly usage: UsageService,
  ) {}

  /** Compare 2–5 of the user's documents and produce consensus + differences. */
  async run(userId: string, documentIds: string[], query: string) {
    if (documentIds.length < 2 || documentIds.length > 5) {
      throw new BadRequestException('Choose between 2 and 5 documents');
    }
    const docs = await this.prisma.document.findMany({
      where: { id: { in: documentIds }, userId, status: 'READY' },
      select: { title: true, text: true, language: true },
    });
    if (docs.length < 2) {
      throw new BadRequestException('Need at least 2 ready documents you own');
    }
    await this.usage.reserve(userId, 'synthesis');
    return this.ai.synthesize(
      docs.map((d) => ({ title: d.title, text: d.text })),
      query,
      docs[0].language ?? 'en',
      userId,
    );
  }
}
