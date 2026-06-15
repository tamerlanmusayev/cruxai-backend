import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DocumentsService } from './documents.service';
import { UpdateSummaryDto } from './dto/update-summary.dto';
import { CreateDocumentDto, OverviewDto, RequestUploadsDto } from './dto/upload.dto';
import { RecaptchaGuard } from '../security/recaptcha.guard';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';
import { GenerationLimitGuard } from '../usage/generation-limit.guard';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Step 1 — get presigned URLs to upload the files directly to storage. */
  @Post('uploads')
  @UseGuards(JwtAuthGuard, RecaptchaGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  requestUploads(@Body() body: RequestUploadsDto) {
    return this.documents.requestUploads(body);
  }

  /** Step 2 — create the document from uploaded keys; processing is queued. */
  @Post()
  @UseGuards(JwtAuthGuard, RecaptchaGuard, GenerationLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Req() req: AuthedRequest, @Body() body: CreateDocumentDto) {
    return this.documents.create(body, req.userId);
  }

  /** Generate an AI overview document for a book by title (copyrighted books). */
  @Post('overview')
  @UseGuards(JwtAuthGuard, RecaptchaGuard, GenerationLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  overview(@Req() req: AuthedRequest, @Body() body: OverviewDto) {
    return this.documents.createOverview(body.title, body.lang, req.userId);
  }

  /** The authenticated user's library (paginated). */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @Req() req: AuthedRequest,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.documents.listForUser(
      req.userId!,
      Math.max(0, Number(skip) || 0),
      Math.min(50, Math.max(1, Number(take) || 10)),
    );
  }

  /** A single document (public by id — shareable link). */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documents.findOne(id);
  }

  /** Owner-only delete (cascades to summary/quizzes/flashcards/concepts/etc). */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.documents.remove(id, req.userId!);
  }

  /** Owner-only inline edit of the generated summary. */
  @Patch(':id/summary')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updateSummary(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateSummaryDto,
  ) {
    return this.documents.updateSummary(id, req.userId!, body);
  }
}
