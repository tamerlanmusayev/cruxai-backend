import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConceptsService } from './concepts.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('documents/:id/graph')
@UseGuards(JwtAuthGuard)
export class ConceptsController {
  constructor(private readonly concepts: ConceptsService) {}

  /** Generate (or fetch) the knowledge graph for a document the user owns. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  generate(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.concepts.generateOrGet(id, req.userId!);
  }
}
