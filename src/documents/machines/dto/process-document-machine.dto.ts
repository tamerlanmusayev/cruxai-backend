import type { IncomingFile, SkippedFile } from '../../extract.util';

export interface SourceRef {
  key?: string;
  url?: string;
  name: string;
}

export interface SummaryResult {
  contentMd: string;
  keyPoints: string[];
  citations: unknown;
  language: string;
}

/** Accumulates across the pipeline steps as each transition assigns into it. */
export interface ProcessDocumentContext {
  stateId: string;
  shouldWait: boolean;
  documentId: string;
  userId?: string;
  langHint?: string;
  alreadyDone?: boolean;
  sources: SourceRef[];
  files?: IncomingFile[];
  title?: string;
  text?: string;
  skipped?: SkippedFile[];
  summary?: SummaryResult;
  error?: string;
}

export type ProcessDocumentEvents = { type: 'NEXT' };

export enum ProcessDocumentStates {
  Load = 'load',
  Fetch = 'fetch',
  Extract = 'extract',
  Summarize = 'summarize',
  Persist = 'persist',
  Done = 'done',
  Error = 'error',
}

export type ProcessDocumentTypestate = {
  value: 'load';
  context: ProcessDocumentContext;
};

export interface ProcessDocumentMachineOutput {
  _state?: string;
  documentId: string;
  userId?: string;
  title?: string;
  ok: boolean;
  error?: string;
}
