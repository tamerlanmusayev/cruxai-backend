import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ProcessingService } from './processing.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ProcessingService],
})
export class DocumentsModule {}
