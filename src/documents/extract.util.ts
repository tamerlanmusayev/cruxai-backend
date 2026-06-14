import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

/** Limits — keep processing fast and within the model context budget. */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40 MB across all files
export const MAX_FILES = 20;
export const MAX_PDF_PAGES = 300;
export const MAX_TOTAL_CHARS = 600_000; // combined text cap

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const SUPPORTED = ['.pdf', '.docx', '.txt', '.md', '.markdown'];

function ext(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

/** Extract text from one file based on its extension. */
async function extractOne(file: IncomingFile): Promise<string> {
  const e = ext(file.originalname);
  switch (e) {
    case '.pdf': {
      const data = await pdfParse(file.buffer);
      if ((data.numpages ?? 0) > MAX_PDF_PAGES) {
        throw new Error(
          `"${file.originalname}" has ${data.numpages} pages (limit ${MAX_PDF_PAGES}). Split it or upload one chapter.`,
        );
      }
      return clean(data.text ?? '');
    }
    case '.docx': {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return clean(value ?? '');
    }
    case '.txt':
    case '.md':
    case '.markdown':
      return clean(file.buffer.toString('utf8'));
    default:
      throw new Error(
        `"${file.originalname}": unsupported format. Use PDF, DOCX, TXT or MD.`,
      );
  }
}

export interface SkippedFile {
  name: string;
  reason: string;
}

/**
 * Validate + extract a batch of files. Files that can't be read are skipped
 * (and reported) so one bad file doesn't fail the whole batch; we only throw
 * when NONE of the files could be read, or hard limits are exceeded.
 */
export async function extractFiles(files: IncomingFile[]): Promise<{
  title: string;
  text: string;
  skipped: SkippedFile[];
}> {
  if (!files.length) throw new Error('No files uploaded.');
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files (max ${MAX_FILES}).`);
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    const mb = (total / 1024 / 1024).toFixed(1);
    throw new Error(
      `Total size ${mb} MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024} MB limit. Remove a file or compress them at iLovePDF / Smallpdf.`,
    );
  }

  const parts: string[] = [];
  const used: string[] = [];
  const skipped: SkippedFile[] = [];

  for (const f of files) {
    if (!SUPPORTED.includes(ext(f.originalname))) {
      skipped.push({ name: f.originalname, reason: 'Unsupported format' });
      continue;
    }
    try {
      const text = await extractOne(f);
      if (text.length < 20) {
        skipped.push({
          name: f.originalname,
          reason: 'Looks scanned — no selectable text',
        });
        continue;
      }
      parts.push(files.length > 1 ? `# ${f.originalname}\n\n${text}` : text);
      used.push(f.originalname);
    } catch (err) {
      skipped.push({
        name: f.originalname,
        reason: String((err as Error)?.message ?? err).slice(0, 160),
      });
    }
  }

  if (!parts.length) {
    const why = skipped.map((s) => `${s.name}: ${s.reason}`).join('; ');
    throw new Error(`None of the files could be read. ${why}`);
  }

  let text = parts.join('\n\n---\n\n');
  if (text.length > MAX_TOTAL_CHARS) text = text.slice(0, MAX_TOTAL_CHARS);

  const first = used[0].replace(/\.[a-z0-9]+$/i, '');
  const title = used.length === 1 ? first : `${first} +${used.length - 1} more`;

  return { title: title.slice(0, 200) || 'Untitled', text, skipped };
}

function clean(raw: string): string {
  return raw
    .replace(/ /g, '')
    .replace(/[\t\f\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
