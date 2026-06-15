import { Injectable, Logger } from '@nestjs/common';

const GUTENDEX = process.env.GUTENDEX_URL ?? 'https://gutendex.com/books';

export interface BookHit {
  id: number;
  title: string;
  author: string;
  cover: string | null;
  textUrl: string | null;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string }[];
  formats: Record<string, string>;
}

/**
 * Searches Project Gutenberg (via the Gutendex API) — ~76k public-domain
 * books with downloadable full text, so results can actually be summarized.
 */
@Injectable()
export class BooksService {
  private readonly log = new Logger(BooksService.name);
  private cachedCount = 0;

  async search(q: string): Promise<BookHit[]> {
    if (!q.trim()) return [];
    const res = await fetch(`${GUTENDEX}?search=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Book search failed (${res.status})`);
    const data = (await res.json()) as { count: number; results: GutendexBook[] };
    return data.results.slice(0, 12).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.authors[0]?.name ?? 'Unknown',
      cover: pick(b.formats, 'image/jpeg'),
      textUrl: pickText(b.formats),
    }));
  }

  /** Total catalogue size (for the "X+ books" claim). */
  async count(): Promise<number> {
    if (this.cachedCount) return this.cachedCount;
    try {
      const res = await fetch(GUTENDEX);
      const data = (await res.json()) as { count: number };
      this.cachedCount = data.count ?? 0;
    } catch (e) {
      this.log.warn(`Gutendex count failed: ${e}`);
    }
    return this.cachedCount;
  }
}

function pick(formats: Record<string, string>, mime: string): string | null {
  const key = Object.keys(formats).find((k) => k.startsWith(mime));
  return key ? formats[key] : null;
}

/** Prefer a plain-text format that isn't a .zip archive. */
function pickText(formats: Record<string, string>): string | null {
  const keys = Object.keys(formats).filter((k) => k.startsWith('text/plain'));
  const url = keys.map((k) => formats[k]).find((u) => !u.endsWith('.zip'));
  return url ?? null;
}
