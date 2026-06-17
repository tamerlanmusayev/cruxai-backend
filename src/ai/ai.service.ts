import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import {
  ConceptResult,
  FlashcardDraft,
  FlashcardResult,
  GradeResult,
  QuizQuestion,
  QuizResult,
  SummaryResult,
  SynthesisResult,
} from './ai.types';
import { GenKind, UsageService, creditsFromUsage } from '../usage/usage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Keep input within a safe context budget (chars, not tokens — rough cap).
// Lower cap = cheaper input; a chapter fits comfortably.
const MAX_INPUT_CHARS = 120_000;

// Supported output languages.
const LANG_NAMES: Record<string, string> = {
  az: 'Azerbaijani',
  ru: 'Russian',
  en: 'English',
  tr: 'Turkish',
  kk: 'Kazakh',
  uz: 'Uzbek',
  ka: 'Georgian',
};

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Cost-tuned defaults: Sonnet for the flagship summary, Haiku for the rest.
  private readonly modelSummary = process.env.MODEL_SUMMARY ?? 'claude-sonnet-4-6';
  private readonly modelQuiz = process.env.MODEL_QUIZ ?? 'claude-haiku-4-5';
  private readonly modelGrade = process.env.MODEL_GRADE ?? 'claude-haiku-4-5';

  constructor(
    private readonly usage: UsageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Force structured output via a single tool, STREAMED. Claude must call the
   * tool, so `input` is always valid JSON matching the schema. Streaming lets us
   * (a) push a live token/credit counter to the user during generation, and
   * (b) read ACTUAL usage at the end to settle the budget by real cost.
   */
  private async structured<T>(opts: {
    model: string;
    maxTokens: number;
    system: string;
    user: string;
    toolName: string;
    toolDescription: string;
    schema: Record<string, unknown>;
    kind?: GenKind;
    userId?: string;
  }): Promise<T> {
    const stream = this.client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: opts.toolName },
      messages: [{ role: 'user', content: opts.user }],
    });

    // Live counter: approximate output tokens from streamed JSON (chars/4),
    // throttled, then replaced by the exact figure on completion.
    const live = !!(opts.userId && opts.kind);
    let inputTokens = 0;
    let approxChars = 0;
    let lastEmit = 0;
    if (live) {
      stream.on('streamEvent', (event) => {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage?.input_tokens ?? 0;
        } else if (event.type === 'content_block_delta') {
          const d = event.delta as { type?: string; partial_json?: string; text?: string };
          if (d.type === 'input_json_delta' && d.partial_json) approxChars += d.partial_json.length;
          else if (d.type === 'text_delta' && d.text) approxChars += d.text.length;
          const now = Date.now();
          if (now - lastEmit > 300) {
            lastEmit = now;
            const out = Math.round(approxChars / 4);
            this.realtime.emitTokens(opts.userId!, {
              kind: opts.kind!,
              inputTokens,
              outputTokens: out,
              credits: creditsFromUsage(inputTokens, out, opts.model),
              done: false,
            });
          }
        }
      });
    }

    const final = await stream.finalMessage();
    const block = final.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('Model did not return structured output');
    }

    if (live) {
      const u = final.usage;
      this.realtime.emitTokens(opts.userId!, {
        kind: opts.kind!,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        credits: creditsFromUsage(u.input_tokens, u.output_tokens, opts.model),
        done: true,
      });
      await this.usage.settle(
        opts.userId!,
        opts.kind!,
        u.input_tokens,
        u.output_tokens,
        opts.model,
      );
    }

    return block.input as T;
  }

  private clip(text: string): string {
    if (text.length <= MAX_INPUT_CHARS) return text;
    this.log.warn(
      `Input ${text.length} chars exceeds cap; truncating to ${MAX_INPUT_CHARS}`,
    );
    return text.slice(0, MAX_INPUT_CHARS);
  }

  async summarize(
    title: string,
    chunks: { ordinal: number; section: string | null; text: string }[],
    targetLang?: string,
    userId?: string,
  ): Promise<SummaryResult> {
    const langName = LANG_NAMES[targetLang ?? ''];
    const langRule = langName
      ? `Write the ENTIRE summary and key points in ${langName}, regardless of the source language.`
      : 'Write in the SAME language as the source document.';

    // Build a numbered, citable view of the document.
    const labeled = chunks
      .map((c) => `[${c.ordinal}]${c.section ? ` (${c.section})` : ''} ${c.text}`)
      .join('\n\n');

    const result = await this.structured<SummaryResult>({
      model: this.modelSummary,
      maxTokens: 4096,
      system:
        'You are an expert tutor who distills long books and textbooks into ' +
        'clear, concise study summaries for students. ' +
        langRule +
        ' Ground every claim ONLY in the provided numbered passages; never ' +
        'invent facts. After each major claim in the markdown, add a citation ' +
        'marker like [3] referencing the passage number it came from.',
      user:
        `Document title: "${title}"\n\n` +
        'Summarize the numbered passages below into about 5 pages of markdown ' +
        'with clear headings, short paragraphs, and bullet lists. Add [n] ' +
        'citation markers tied to the passage numbers. Then give 5–10 key ' +
        'takeaways and, in "citations", list each passage you cited with its ' +
        'number, section, and a short verbatim quote. Report the language.\n\n' +
        '--- PASSAGES START ---\n' +
        this.clip(labeled) +
        '\n--- PASSAGES END ---',
      toolName: 'save_summary',
      toolDescription: 'Save the study summary with citations.',
      kind: 'summary',
      userId,
      schema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: 'Language code, e.g. "ru", "en", "az".',
          },
          contentMd: {
            type: 'string',
            description: 'Summary markdown (~5 pages) with [n] citation markers.',
          },
          keyPoints: {
            type: 'array',
            items: { type: 'string' },
            description: '5–10 key takeaways.',
          },
          citations: {
            type: 'array',
            description: 'Sources behind the [n] markers actually used.',
            items: {
              type: 'object',
              properties: {
                n: { type: 'integer' },
                section: { type: ['string', 'null'] },
                quote: {
                  type: 'string',
                  description: 'Short verbatim snippet from that passage (<160 chars).',
                },
              },
              required: ['n', 'quote'],
            },
          },
        },
        required: ['language', 'contentMd', 'keyPoints', 'citations'],
      },
    });
    if (langName) result.language = targetLang!;
    return result;
  }

  async makeQuiz(
    title: string,
    text: string,
    language: string,
    count = 5,
    focusConcepts: string[] = [],
    userId?: string,
    kind: GenKind = 'quiz',
  ): Promise<QuizQuestion[]> {
    const focus = focusConcepts.length
      ? `The student is weak on these topics — prioritise questions that test ` +
        `them: ${focusConcepts.join(', ')}.\n`
      : '';
    const result = await this.structured<QuizResult>({
      model: this.modelQuiz,
      maxTokens: 4096,
      system:
        'You are a teacher who writes fair multiple-choice questions that test ' +
        `real understanding. Write everything in this language: ${language}.`,
      user:
        `Document title: "${title}"\n\n` +
        focus +
        `Create exactly ${count} multiple-choice questions based ONLY on the ` +
        'material below. Each question has exactly 4 options, one correct. Mix ' +
        'recall and understanding. Give a short explanation and a short ' +
        '"concept" topic label (2-4 words) for each question.\n\n' +
        '--- DOCUMENT START ---\n' +
        this.clip(text) +
        '\n--- DOCUMENT END ---',
      toolName: 'save_quiz',
      toolDescription: 'Save the generated quiz questions.',
      kind,
      userId,
      schema: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: count,
            maxItems: count,
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: {
                  type: 'array',
                  minItems: 4,
                  maxItems: 4,
                  items: { type: 'string' },
                },
                correctIndex: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 3,
                },
                explanation: { type: 'string' },
                concept: { type: 'string' },
              },
              required: [
                'question',
                'options',
                'correctIndex',
                'explanation',
                'concept',
              ],
            },
          },
        },
        required: ['questions'],
      },
    });
    return result.questions;
  }

  async makeFlashcards(
    title: string,
    text: string,
    language: string,
    userId?: string,
  ): Promise<FlashcardDraft[]> {
    const result = await this.structured<FlashcardResult>({
      model: this.modelQuiz,
      maxTokens: 4096,
      system:
        'You create concise study flashcards that test active recall. ' +
        `Write everything in this language: ${language}. ` +
        'Front = a short question or prompt; back = a clear, correct answer.',
      user:
        `Document title: "${title}"\n\n` +
        'Create 10–15 flashcards covering the most important facts and concepts ' +
        'from the material below. Keep each side short. Tag difficulty.\n\n' +
        '--- DOCUMENT START ---\n' +
        this.clip(text) +
        '\n--- DOCUMENT END ---',
      toolName: 'save_flashcards',
      toolDescription: 'Save the generated flashcards.',
      kind: 'flashcards',
      userId,
      schema: {
        type: 'object',
        properties: {
          cards: {
            type: 'array',
            minItems: 10,
            maxItems: 15,
            items: {
              type: 'object',
              properties: {
                front: { type: 'string' },
                back: { type: 'string' },
                difficulty: {
                  type: 'string',
                  enum: ['EASY', 'MEDIUM', 'HARD'],
                },
              },
              required: ['front', 'back', 'difficulty'],
            },
          },
        },
        required: ['cards'],
      },
    });
    return result.cards;
  }

  async extractConcepts(
    title: string,
    text: string,
    language: string,
    userId?: string,
  ): Promise<ConceptResult> {
    return this.structured<ConceptResult>({
      model: this.modelQuiz,
      maxTokens: 4096,
      system:
        'You extract a knowledge graph of the key concepts in study material. ' +
        `Write names and definitions in this language: ${language}.`,
      user:
        `Document title: "${title}"\n\n` +
        'Identify 8–16 key concepts. For each: a short name, a 1–2 sentence ' +
        'definition, and a difficulty. Then list relationships as edges using ' +
        'the 0-based index of concepts (relation: prerequisite | part-of | ' +
        'related).\n\n--- DOCUMENT START ---\n' +
        this.clip(text) +
        '\n--- DOCUMENT END ---',
      toolName: 'save_graph',
      toolDescription: 'Save the concept knowledge graph.',
      kind: 'graph',
      userId,
      schema: {
        type: 'object',
        properties: {
          concepts: {
            type: 'array',
            minItems: 6,
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                summary: { type: 'string' },
                difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
              },
              required: ['name', 'summary', 'difficulty'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'integer' },
                to: { type: 'integer' },
                relation: {
                  type: 'string',
                  enum: ['prerequisite', 'part-of', 'related'],
                },
              },
              required: ['from', 'to', 'relation'],
            },
          },
        },
        required: ['concepts', 'edges'],
      },
    });
  }

  async synthesize(
    sources: { title: string; text: string }[],
    query: string,
    language: string,
    userId?: string,
  ): Promise<SynthesisResult> {
    const labeled = sources
      .map((s, i) => `=== SOURCE ${i + 1}: ${s.title} ===\n${this.clip(s.text)}`)
      .join('\n\n');
    return this.structured<SynthesisResult>({
      model: this.modelSummary,
      maxTokens: 4096,
      system:
        'You compare multiple sources and produce a unified, balanced answer. ' +
        `Write in this language: ${language}. Cite source numbers like (S1).`,
      user:
        `Question: ${query}\n\n` +
        'Using ONLY the sources below, write a consensus explanation in ' +
        'markdown, then list the notable differences/disagreements between ' +
        'sources.\n\n' +
        labeled,
      toolName: 'save_synthesis',
      toolDescription: 'Save the multi-source synthesis.',
      kind: 'synthesis',
      userId,
      schema: {
        type: 'object',
        properties: {
          consensus: { type: 'string' },
          differences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                point: { type: 'string' },
                sources: { type: 'array', items: { type: 'string' } },
              },
              required: ['point', 'sources'],
            },
          },
        },
        required: ['consensus', 'differences'],
      },
    });
  }

  /**
   * Write a study overview of a well-known book FROM THE MODEL'S KNOWLEDGE
   * (used for copyrighted books whose full text we can't legally fetch).
   * Clearly framed as an overview, not a citation-grounded summary.
   */
  async bookOverview(
    title: string,
    targetLang?: string,
    userId?: string,
  ): Promise<{ contentMd: string; keyPoints: string[]; language: string }> {
    const langName = LANG_NAMES[targetLang ?? ''];
    const langRule = langName
      ? `Write everything in ${langName}.`
      : 'Write in the language of the book title, or English if unsure.';
    const result = await this.structured<{ contentMd: string; keyPoints: string[] }>({
      model: this.modelSummary,
      maxTokens: 4096,
      system:
        'You are an expert tutor. Write a clear study overview of a well-known ' +
        'book from your own knowledge of it. ' +
        langRule +
        ' Cover the core ideas, key arguments, structure, and main takeaways. ' +
        'Begin with a short italicized note that this is an AI overview based on ' +
        'public knowledge of the book, not its full text. Never invent a book — ' +
        'if you do not actually know it, say so plainly in the overview.',
      user:
        `Write a ~2 page markdown study overview of the book titled "${title}". ` +
        'Use headings and bullet lists. Then give 5–8 key takeaways.',
      toolName: 'save_overview',
      toolDescription: 'Save the book overview.',
      kind: 'overview',
      userId,
      schema: {
        type: 'object',
        properties: {
          contentMd: { type: 'string', description: 'Overview markdown (~2 pages).' },
          keyPoints: { type: 'array', items: { type: 'string' }, description: '5–8 takeaways.' },
        },
        required: ['contentMd', 'keyPoints'],
      },
    });
    return { ...result, language: targetLang ?? 'en' };
  }

  /** Recommend well-known real books for a learning goal/topic. */
  async recommendBooks(
    topic: string,
    targetLang?: string,
    userId?: string,
  ): Promise<{ title: string; author: string; why: string }[]> {
    const langName = LANG_NAMES[targetLang ?? ''] ?? 'English';
    const result = await this.structured<{
      books: { title: string; author: string; why: string }[];
    }>({
      model: this.modelQuiz,
      maxTokens: 2048,
      system:
        'You are a well-read librarian. Recommend real, well-known, existing ' +
        `books (never invent titles). Write the "why" in ${langName}, but keep ` +
        'each book title in its original language/spelling so it can be searched.',
      user:
        `Recommend up to 8 of the best books for this goal: "${topic}". ` +
        'For each, give the exact title, the author, and one short sentence on ' +
        'why it is worth reading for this goal.',
      toolName: 'save_recommendations',
      toolDescription: 'Save the recommended book list.',
      kind: 'recommend',
      userId,
      schema: {
        type: 'object',
        properties: {
          books: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                why: { type: 'string' },
              },
              required: ['title', 'author', 'why'],
            },
          },
        },
        required: ['books'],
      },
    });
    return result.books;
  }

  async grade(
    questions: QuizQuestion[],
    answers: number[],
    language: string,
    userId?: string,
  ): Promise<GradeResult> {
    const payload = questions.map((q, i) => ({
      index: i,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      chosenIndex: answers[i] ?? -1,
    }));

    return this.structured<GradeResult>({
      model: this.modelGrade,
      maxTokens: 4096,
      system:
        'You are a supportive tutor. For each answer, say if it is correct, and ' +
        'explain clearly why — if wrong, explain the mistake and the right idea. ' +
        `Write in this language: ${language}.`,
      user:
        'Grade these answers. For each item return tailored feedback.\n\n' +
        JSON.stringify(payload, null, 2),
      toolName: 'save_feedback',
      toolDescription: 'Save per-question grading feedback.',
      kind: 'grade',
      userId,
      schema: {
        type: 'object',
        properties: {
          feedback: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                correct: { type: 'boolean' },
                correctIndex: { type: 'integer' },
                chosenIndex: { type: 'integer' },
                explanation: { type: 'string' },
              },
              required: [
                'index',
                'correct',
                'correctIndex',
                'chosenIndex',
                'explanation',
              ],
            },
          },
        },
        required: ['feedback'],
      },
    });
  }
}
