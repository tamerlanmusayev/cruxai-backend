import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assign, createMachine, interpret, StateMachine } from 'xstate';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { StorageService } from '../../storage/storage.service';
import {
  extractFiles,
  IncomingFile,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from '../extract.util';
import { chunkText } from '../chunk.util';
import { friendlyError } from '../friendly-error.util';
import {
  ProcessDocumentContext,
  ProcessDocumentEvents,
  ProcessDocumentMachineOutput,
  ProcessDocumentStates,
  ProcessDocumentTypestate,
  SourceRef,
} from './dto/process-document-machine.dto';

const MAX_REMOTE_BYTES = 40 * 1024 * 1024;

/**
 * Document ingest pipeline as an explicit XState machine (mirrors the
 * backend-api `*.machine.ts` convention): load → fetch → extract → summarize
 * → persist, with a single `error` final that marks the document FAILED.
 * Each step is an invoked service; context accumulates as it advances.
 */
@Injectable()
export class ProcessDocumentMachine {
  private readonly logger = new Logger(ProcessDocumentMachine.name);
  private machine: StateMachine<
    ProcessDocumentContext,
    ProcessDocumentTypestate,
    ProcessDocumentEvents
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {
    this.initializeMachine();
  }

  private initializeMachine() {
    this.machine = createMachine(
      {
        id: 'Process document',
        initial: ProcessDocumentStates.Load,
        states: {
          load: {
            invoke: {
              src: (ctx) => this.loadDoc(ctx),
              onDone: [
                {
                  cond: (_, e) => !!e.data.alreadyDone,
                  actions: assign({ alreadyDone: (_, e) => e.data.alreadyDone }),
                  target: ProcessDocumentStates.Done,
                },
                {
                  actions: assign({
                    userId: (_, e) => e.data.userId,
                    langHint: (_, e) => e.data.langHint,
                    sources: (_, e) => e.data.sources,
                  }),
                  target: ProcessDocumentStates.Fetch,
                },
              ],
              onError: { target: ProcessDocumentStates.Error },
            },
          },
          fetch: {
            invoke: {
              src: (ctx) => this.fetchBytes(ctx),
              onDone: {
                actions: assign({ files: (_, e) => e.data }),
                target: ProcessDocumentStates.Extract,
              },
              onError: { target: ProcessDocumentStates.Error },
            },
          },
          extract: {
            invoke: {
              src: (ctx) => this.runExtract(ctx),
              onDone: {
                actions: assign({
                  title: (_, e) => e.data.title,
                  text: (_, e) => e.data.text,
                  skipped: (_, e) => e.data.skipped,
                }),
                target: ProcessDocumentStates.Summarize,
              },
              onError: { target: ProcessDocumentStates.Error },
            },
          },
          summarize: {
            invoke: {
              src: (ctx) => this.runSummarize(ctx),
              onDone: {
                actions: assign({ summary: (_, e) => e.data }),
                target: ProcessDocumentStates.Persist,
              },
              onError: { target: ProcessDocumentStates.Error },
            },
          },
          persist: {
            invoke: {
              src: (ctx) => this.persist(ctx),
              onDone: { target: ProcessDocumentStates.Done },
              onError: { target: ProcessDocumentStates.Error },
            },
          },
          done: { type: 'final' },
          error: {
            type: 'final',
            entry: [
              assign({ error: (_, e: any) => String(e?.data?.message ?? e?.data ?? 'failed') }),
              (ctx, e: any) => this.markFailed(ctx.documentId, String(e?.data?.message ?? e?.data)),
            ],
          },
        },
        schema: {
          context: {} as ProcessDocumentContext,
          events: {} as ProcessDocumentEvents,
        },
        predictableActionArguments: true,
        preserveActionOrder: true,
      },
      { actions: {}, services: {} },
    );
  }

  /** Run the pipeline to completion; resolves with the final output. */
  run(documentId: string): Promise<ProcessDocumentMachineOutput> {
    return new Promise((resolve) => {
      const actor = interpret(
        this.machine.withContext({
          stateId: documentId,
          shouldWait: false,
          documentId,
          sources: [],
        }),
      );
      actor.onDone(() => {
        const { value, context } = actor.getSnapshot();
        resolve({ ...this.getOutputFromContext(context), _state: String(value) });
      });
      actor.start();
    });
  }

  getOutputFromContext(ctx: ProcessDocumentContext): ProcessDocumentMachineOutput {
    return {
      documentId: ctx.documentId,
      userId: ctx.userId,
      title: ctx.title,
      ok: !ctx.error,
      error: ctx.error,
    };
  }

  // ---- step services ----

  private async loadDoc(ctx: ProcessDocumentContext) {
    const doc = await this.prisma.document.findUnique({
      where: { id: ctx.documentId },
      select: { sources: true, language: true, status: true, userId: true },
    });
    if (!doc) throw new Error(`Document ${ctx.documentId} not found`);
    const sources = (doc.sources as unknown as SourceRef[] | null) ?? [];
    if (doc.status !== 'READY' && !sources.length) {
      throw new Error('No source files were uploaded.');
    }
    if (doc.status !== 'READY') {
      await this.prisma.document.update({
        where: { id: ctx.documentId },
        data: { status: 'PROCESSING' },
      });
    }
    return {
      userId: doc.userId ?? undefined,
      langHint: doc.language ?? undefined,
      sources,
      alreadyDone: doc.status === 'READY',
    };
  }

  private async fetchBytes(ctx: ProcessDocumentContext): Promise<IncomingFile[]> {
    const files = await Promise.all(
      ctx.sources.map(async (s) => {
        const buffer = s.url ? await this.fetchRemote(s.url) : await this.storage.get(s.key!);
        // Re-check actual bytes server-side — the presign step trusts the
        // client-declared size, and S3 presigned PUTs don't enforce a size,
        // so this is the real per-file guard (bounds extract + AI cost).
        if (buffer.length > MAX_FILE_BYTES) {
          throw new Error(
            `"${nameFor(s)}" is too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per file).`,
          );
        }
        return { originalname: nameFor(s), mimetype: '', buffer, size: buffer.length };
      }),
    );
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(
        `Files exceed the ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB total limit.`,
      );
    }
    return files;
  }

  private async runExtract(ctx: ProcessDocumentContext) {
    return extractFiles(ctx.files ?? []);
  }

  private async runSummarize(ctx: ProcessDocumentContext) {
    const chunks = chunkText(ctx.text ?? '');
    return this.ai.summarize(ctx.title ?? 'Untitled', chunks, ctx.langHint, ctx.userId);
  }

  private async persist(ctx: ProcessDocumentContext) {
    const chunks = chunkText(ctx.text ?? '');
    const summary = ctx.summary!;
    await this.prisma.$transaction([
      this.prisma.chunk.createMany({
        data: chunks.map((c) => ({
          documentId: ctx.documentId,
          ordinal: c.ordinal,
          section: c.section,
          text: c.text,
        })),
      }),
      this.prisma.summary.create({
        data: {
          documentId: ctx.documentId,
          contentMd: summary.contentMd,
          keyPoints: summary.keyPoints,
          citations: summary.citations as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.document.update({
        where: { id: ctx.documentId },
        data: {
          status: 'READY',
          title: ctx.title,
          text: ctx.text,
          language: summary.language,
          skipped: ctx.skipped?.length
            ? (ctx.skipped as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      }),
    ]);
    this.logger.log(
      `Document ${ctx.documentId} summarized (${summary.language}, ${chunks.length} chunks)`,
    );
  }

  private async fetchRemote(url: string): Promise<Buffer> {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Could not download the link (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_REMOTE_BYTES) {
      throw new Error('The linked file is too large (over 40 MB).');
    }
    return buf;
  }

  private async markFailed(documentId: string, raw: string) {
    this.logger.error(`Document ${documentId} failed: ${raw}`);
    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', error: friendlyError(raw) },
      });
    } catch (e) {
      this.logger.error(`Could not mark ${documentId} FAILED: ${e}`);
    }
  }
}

/** Ensure the source has a usable file extension so the extractor can parse it. */
function nameFor(s: SourceRef): string {
  if (/\.[a-z0-9]+$/i.test(s.name)) return s.name;
  const fromUrl = s.url?.match(/\.[a-z0-9]+(?=$|\?)/i)?.[0];
  return `${s.name}${fromUrl ?? '.txt'}`;
}
