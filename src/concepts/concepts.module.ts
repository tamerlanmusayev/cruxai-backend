import { Module } from '@nestjs/common';
import { ConceptsController } from './concepts.controller';
import { ConceptsService } from './concepts.service';

@Module({
  controllers: [ConceptsController],
  providers: [ConceptsService],
})
export class ConceptsModule {}
