/**
 * DEMO MODE — simulated, growing numbers for presentations/mockups only.
 * Enabled by env DEMO_MODE=true. OFF by default (production shows real data).
 * These numbers are clearly synthetic and must never be presented as real
 * analytics or used as evidence anywhere.
 */
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Launch anchor — totals grow from this date forward.
const ANCHOR = Date.UTC(2026, 4, 1); // 2026-05-01
const DAY_MS = 86_400_000;

// Deterministic pseudo-random in [0,1) from an integer seed.
function rng(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function dayIndex(now: number): number {
  return Math.max(0, Math.floor((now - ANCHOR) / DAY_MS));
}

// New users on a given day: 35–70.
function usersOnDay(d: number): number {
  return 35 + Math.floor(rng(d) * 36);
}

// Summaries created on a given day: ~2–4 per new user.
function summariesOnDay(d: number): number {
  return Math.round(usersOnDay(d) * (2 + rng(d + 101) * 2));
}

/** Online right now: 8–20, refreshed roughly every 30 seconds. */
export function demoOnline(now: number): number {
  const tick = Math.floor(now / 30_000);
  return 8 + Math.floor(rng(tick) * 13); // 8..20
}

export interface DemoStats {
  documents: number;
  summaries: number;
  quizzes: number;
  attempts: number;
  summariesToday: number;
  daily: { day: string; count: number }[];
  monthly: { day: string; count: number }[];
  countries: { code: string; name: string; pct: number }[];
}

// Demo audience split (sums to 100). DEMO ONLY — not real analytics.
const DEMO_COUNTRIES = [
  { code: 'AZ', name: 'Azerbaijan', pct: 74 },
  { code: 'KZ', name: 'Kazakhstan', pct: 8 },
  { code: 'GE', name: 'Georgia', pct: 7 },
  { code: 'UZ', name: 'Uzbekistan', pct: 6 },
  { code: 'TR', name: 'Türkiye', pct: 5 },
];

function ymd(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function ym(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

/** Cumulative + series numbers up to `now`. */
export function demoStats(now: number): DemoStats {
  const today = dayIndex(now);

  // Fraction of today elapsed → totals tick up on every refresh through the day.
  const startOfToday = ANCHOR + today * DAY_MS;
  const dayFrac = Math.min(1, Math.max(0.04, (now - startOfToday) / DAY_MS));

  let summaries = 0;
  for (let d = 0; d < today; d++) summaries += summariesOnDay(d);
  const summariesToday = Math.round(summariesOnDay(today) * dayFrac);
  summaries += summariesToday;
  const documents = Math.round(summaries * 1.12); // some still processing/failed
  const quizzes = Math.round(summaries * 0.64);
  const attempts = Math.round(quizzes * 1.35);

  const daily: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = today - i;
    if (d < 0) continue;
    daily.push({ day: ymd(ANCHOR + d * DAY_MS), count: summariesOnDay(d) });
  }

  const monthly: { day: string; count: number }[] = [];
  for (let m = 5; m >= 0; m--) {
    const monthStart = new Date(now);
    monthStart.setUTCMonth(monthStart.getUTCMonth() - m, 1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    let count = 0;
    for (
      let t = Math.max(ANCHOR, monthStart.getTime());
      t < Math.min(now, monthEnd.getTime());
      t += DAY_MS
    ) {
      count += summariesOnDay(dayIndex(t));
    }
    monthly.push({ day: ym(monthStart.getTime()), count });
  }

  return {
    documents,
    summaries,
    quizzes,
    attempts,
    summariesToday,
    daily,
    monthly,
    countries: DEMO_COUNTRIES,
  };
}

// ---- demo reviews (DEMO_MODE only — synthetic, never stored in the DB) ----
interface DemoReview {
  id: string;
  rating: number;
  comment: string;
  name: string;
  createdAt: string;
}

const DEMO_REVIEW_ITEMS: DemoReview[] = [
  { id: 'd1', rating: 5, comment: 'İmtahana hazırlaşmaq üçün ən yaxşı alət. Konspektlər çox aydındır!', name: 'Nigar', createdAt: '2026-06-12T09:20:00.000Z' },
  { id: 'd2', rating: 5, comment: 'Загрузил учебник — через минуту готовый конспект и тест по слабым темам. Огонь.', name: 'Руслан', createdAt: '2026-06-11T17:05:00.000Z' },
  { id: 'd3', rating: 5, comment: 'Finally a study tool that actually cites the source. Saved me hours.', name: 'Aydan', createdAt: '2026-06-10T13:40:00.000Z' },
  { id: 'd4', rating: 4, comment: 'Çox faydalıdır, audio funksiyası da əladır. Bəzən böyük PDF-lər yavaş işlənir.', name: 'Elvin', createdAt: '2026-06-09T20:15:00.000Z' },
  { id: 'd5', rating: 5, comment: 'Карточки с интервальным повторением — то, чего мне не хватало. Спасибо!', name: 'Камила', createdAt: '2026-06-08T08:50:00.000Z' },
  { id: 'd6', rating: 5, comment: 'Free and open source, works in Azerbaijani too. Recommended to my whole group.', name: 'Tural', createdAt: '2026-06-06T11:30:00.000Z' },
];

export const DEMO_REVIEWS = {
  average: 4.8,
  count: 128,
  items: DEMO_REVIEW_ITEMS,
};
