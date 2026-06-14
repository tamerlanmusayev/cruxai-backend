import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mdToPlain } from './text.util';

const PROVIDER = process.env.AUDIO_PROVIDER ?? ''; // '' | 'elevenlabs'
const MAX_TTS_CHARS = 2500;
const ELEVENLABS_URL =
  process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL =
  process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
const DEFAULT_VOICE =
  process.env.ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';

@Injectable()
export class AudioService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return PROVIDER === 'elevenlabs' && !!process.env.ELEVENLABS_API_KEY;
  }

  /** Synthesize the summary to MP3 via the configured provider (owner only). */
  async speak(documentId: string, userId: string): Promise<Buffer> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { summary: { select: { contentMd: true } } },
    });
    if (!doc?.summary) throw new NotFoundException('Summary not found');
    const summary = doc.summary;

    const text = mdToPlain(summary.contentMd).slice(0, MAX_TTS_CHARS);

    const res = await fetch(`${ELEVENLABS_URL}/${DEFAULT_VOICE}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY as string,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
    });
    if (!res.ok) {
      throw new Error(`TTS provider error (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
