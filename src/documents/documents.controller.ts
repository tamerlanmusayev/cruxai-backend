import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DocumentsService } from './documents.service';
import { IncomingFile, MAX_FILES, MAX_TOTAL_BYTES } from './extract.util';
import { RecaptchaGuard } from '../security/recaptcha.guard';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Upload one or more files (combined into a single study set). */
  @Post()
  @UseGuards(JwtAuthGuard, RecaptchaGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 uploads / minute / IP
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_TOTAL_BYTES, files: MAX_FILES },
    }),
  )
  async upload(
    @Req() req: AuthedRequest,
    @UploadedFiles() files?: IncomingFile[],
    @Body('lang') lang?: string,
  ) {
    if (!files?.length) {
      throw new BadRequestException('No files uploaded (field "files")');
    }
    const language = ['az', 'ru', 'en'].includes(lang ?? '') ? lang : undefined;
    try {
      return await this.documents.createFromFiles(files, language, req.userId);
    } catch (err) {
      throw new BadRequestException(String((err as Error)?.message ?? err));
    }
  }

  /** The authenticated user's library. */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthedRequest) {
    return this.documents.listForUser(req.userId!);
  }

  /** A single document (public by id — shareable link). */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documents.findOne(id);
  }
}
