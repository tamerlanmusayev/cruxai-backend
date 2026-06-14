import {
  Controller,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AudioService } from './audio.service';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('documents/:id/audio')
@UseGuards(JwtAuthGuard)
export class AudioController {
  constructor(private readonly audio: AudioService) {}

  /**
   * Returns MP3 audio when a premium TTS provider is configured; otherwise
   * tells the client to fall back to browser speech synthesis.
   */
  @Post()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async speak(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | { provider: string }> {
    if (!this.audio.enabled) {
      return { provider: 'browser' };
    }
    const mp3 = await this.audio.speak(id, req.userId!);
    res.setHeader('Content-Type', 'audio/mpeg');
    return new StreamableFile(mp3);
  }
}
