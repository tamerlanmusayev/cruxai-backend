import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ProcessingService } from './processing.service';
import { ProcessDocumentMachine } from './machines/process-document.machine';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ProcessingService, ProcessDocumentMachine],
})
export class DocumentsModule {}
