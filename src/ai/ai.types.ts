export interface SummaryCitation {
  n: number; // citation number used as [n] in the markdown
  section: string | null; // source heading/section
  quote: string; // short verbatim snippet grounding the claim
}

export interface SummaryResult {
  language: string; // ISO-ish code: "ru" | "en" | "az" | ...
  contentMd: string; // markdown, ~5 pages, with [n] citation markers
  keyPoints: string[]; // 5–10 bullet takeaways
  citations: SummaryCitation[];
}

export interface QuizQuestion {
  question: string;
  options: string[]; // exactly 4
  correctIndex: number; // 0..3
  explanation: string; // why the correct answer is right
  concept: string; // short topic label, used for adaptive mastery tracking
}

export interface QuizResult {
  questions: QuizQuestion[];
}

export interface QuestionFeedback {
  index: number;
  correct: boolean;
  correctIndex: number;
  chosenIndex: number;
  explanation: string; // tailored: why user's answer was right/wrong
}

export interface GradeResult {
  feedback: QuestionFeedback[];
}

export interface FlashcardDraft {
  front: string; // question / prompt
  back: string; // answer
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface FlashcardResult {
  cards: FlashcardDraft[];
}

export interface ConceptDraft {
  name: string;
  summary: string; // 1-2 sentence definition
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface ConceptEdgeDraft {
  from: number; // index into concepts[]
  to: number; // index into concepts[]
  relation: 'prerequisite' | 'part-of' | 'related';
}

export interface ConceptResult {
  concepts: ConceptDraft[];
  edges: ConceptEdgeDraft[];
}

export interface SynthesisResult {
  consensus: string; // markdown
  differences: { point: string; sources: string[] }[];
}
