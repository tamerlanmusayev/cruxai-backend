import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ConceptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** Build the knowledge graph for a document the user owns; cache after. */
  async generateOrGet(documentId: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const existing = await this.prisma.concept.findMany({
      where: { documentId, summary: { not: '' } },
    });
    if (existing.length) return this.toGraph(documentId);

    if (doc.status !== 'READY') {
      throw new BadRequestException('Document is not ready yet');
    }

    // Extract from the (short) summary, not the full text — far cheaper.
    const summary = await this.prisma.summary.findUnique({
      where: { documentId },
      select: { contentMd: true },
    });
    const { concepts, edges } = await this.ai.extractConcepts(
      doc.title,
      summary?.contentMd ?? doc.text,
      doc.language ?? 'en',
    );

    // Create concepts, keep index → id map for edges.
    const created = await Promise.all(
      concepts.map((c) =>
        this.prisma.concept.create({
          data: {
            documentId,
            name: c.name,
            summary: c.summary,
            difficulty: c.difficulty,
          },
          select: { id: true },
        }),
      ),
    );
    const idByIndex = created.map((c) => c.id);

    const edgeData = edges
      .filter(
        (e) =>
          e.from !== e.to &&
          idByIndex[e.from] &&
          idByIndex[e.to],
      )
      .map((e) => ({
        fromId: idByIndex[e.from],
        toId: idByIndex[e.to],
        relation: e.relation,
      }));
    if (edgeData.length) {
      await this.prisma.conceptEdge.createMany({
        data: edgeData,
        skipDuplicates: true,
      });
    }

    return this.toGraph(documentId);
  }

  private async toGraph(documentId: string) {
    const concepts = await this.prisma.concept.findMany({
      where: { documentId, summary: { not: '' } },
      select: { id: true, name: true, summary: true, difficulty: true },
    });
    const edges = await this.prisma.conceptEdge.findMany({
      where: { from: { documentId } },
      select: { fromId: true, toId: true, relation: true },
    });
    return {
      nodes: concepts,
      edges: edges.map((e) => ({
        from: e.fromId,
        to: e.toId,
        relation: e.relation,
      })),
    };
  }
}
