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

// Keep input within a safe context budget (chars, not tokens — rough cap).
const MAX_INPUT_CHARS = 360_000;

// Supported output languages.
const LANG_NAMES: Record<string, string> = {
  az: 'Azerbaijani',
  ru: 'Russian',
  en: 'English',
};

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  private readonly modelSummary = process.env.MODEL_SUMMARY ?? 'claude-opus-4-8';
  private readonly modelQuiz = process.env.MODEL_QUIZ ?? 'claude-opus-4-8';
  private readonly modelGrade = process.env.MODEL_GRADE ?? 'claude-sonnet-4-6';

  /**
   * Force structured output via a single tool. Claude must call the tool,
   * so `input` is always valid JSON matching the schema — no brittle parsing.
   */
  private async structured<T>(opts: {
    model: string;
    maxTokens: number;
    system: string;
    user: string;
    toolName: string;
    toolDescription: string;
    schema: Record<string, unknown>;
  }): Promise<T> {
    const res = await this.client.messages.create({
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

    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('Model did not return structured output');
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
      maxTokens: 8192,
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
  ): Promise<QuizQuestion[]> {
    const focus = focusConcepts.length
      ? `The student is weak on these topics — prioritise questions that test ` +
        `them: ${focusConcepts.join(', ')}.\n`
      : '';
    const result = await this.structured<QuizResult>({
      model: this.modelQuiz,
      maxTokens: 8192,
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

  async grade(
    questions: QuizQuestion[],
    answers: number[],
    language: string,
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
