import {
  BadRequestException,
  Controller,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { StorageService } from './storage.service';
import { MAX_TOTAL_BYTES } from '../documents/extract.util';

/**
 * Receives the raw bytes of a presigned PUT for the LOCAL storage driver.
 * Under the s3 driver this endpoint is unused (browsers PUT straight to S3).
 * The request carries no auth header — it is authorized by the HMAC `sig`
 * that StorageService.presignPut embedded in the URL.
 */
@ApiExcludeController()
@Controller('storage/local')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Put('*')
  async put(
    @Param('0') key: string,
    @Query('sig') sig: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    if (!this.storage.verify(key, sig)) {
      throw new BadRequestException('Invalid upload signature');
    }
    const buffer = await readBody(req, MAX_TOTAL_BYTES);
    await this.storage.putLocal(key, buffer);
    return { ok: true };
  }
}

/** Collect a raw request stream into a Buffer, capped at `limit` bytes. */
function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BadRequestException('File too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
