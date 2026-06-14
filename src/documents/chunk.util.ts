export interface Chunk {
  ordinal: number;
  section: string | null;
  text: string;
}

const TARGET = 1400; // ~chars per chunk

/** Heuristic: short, heading-like lines become the current section label. */
function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length === 0 || l.length > 80) return false;
  if (l.startsWith('#')) return true; // markdown / our multi-file markers
  // Title-ish line without trailing sentence punctuation
  return /^[A-Z0-9\p{Lu}]/u.test(l) && !/[.!?]$/.test(l) && l.split(' ').length <= 10;
}

/** Split text into ordered chunks on paragraph boundaries, tracking section. */
export function chunkText(text: string): Chunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let buf = '';
  let section: string | null = null;
  let ordinal = 1;

  const flush = () => {
    const t = buf.trim();
    if (t.length) chunks.push({ ordinal: ordinal++, section, text: t });
    buf = '';
  };

  for (const para of paragraphs) {
    const firstLine = para.split('\n')[0] ?? '';
    if (isHeading(firstLine)) {
      section = firstLine.replace(/^#+\s*/, '').trim().slice(0, 80);
    }
    if (buf.length + para.length > TARGET && buf.length > 0) flush();
    buf += (buf ? '\n\n' : '') + para;
  }
  flush();
  return chunks;
}
