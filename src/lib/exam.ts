import type { ModuleDef, Question } from './types';
import { rng, shuffle } from './random';

const usable = (q: Question, use: 'test' | 'exam' | 'practice') => (q.use ?? ['practice', 'test', 'exam']).includes(use);

/** Split `size` across modules proportionally to `weights` (largest remainder), at least 1 each when possible. */
export function apportion(size: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights).filter((k) => weights[k] > 0);
  const total = ids.reduce((a, k) => a + weights[k], 0);
  const out: Record<string, number> = {};
  if (!ids.length || size <= 0) return out;
  const base = size >= ids.length ? 1 : 0;
  let left = size - base * ids.length;
  const raw = ids.map((k) => ({ k, x: (weights[k] / total) * left }));
  for (const r of raw) out[r.k] = base + Math.floor(r.x);
  left -= raw.reduce((a, r) => a + Math.floor(r.x), 0);
  raw.sort((a, b) => b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)));
  for (let i = 0; i < left; i++) out[raw[i % raw.length].k]++;
  return out;
}

/** Least-seen first, random among equals. */
function rankBySeen(r: () => number, qs: Question[], seen: Record<string, number>) {
  return shuffle(r, qs).sort((a, b) => (seen[a.id] ?? 0) - (seen[b.id] ?? 0));
}

export function assembleExam(
  pool: Question[],
  opts: { size: number; weights: Record<string, number>; seen: Record<string, number>; seed: number },
): string[] {
  const r = rng(opts.seed);
  const counts = apportion(opts.size, opts.weights);
  const picked: string[] = [];
  const leftovers: Question[] = [];
  for (const [mod, n] of Object.entries(counts)) {
    const ranked = rankBySeen(r, pool.filter((q) => q.module === mod && usable(q, 'exam')), opts.seen);
    picked.push(...ranked.slice(0, n).map((q) => q.id));
    leftovers.push(...ranked.slice(n));
  }
  // a module without enough questions: top up from the others
  for (const q of rankBySeen(r, leftovers, opts.seen)) {
    if (picked.length >= opts.size) break;
    picked.push(q.id);
  }
  return shuffle(r, picked);
}

/** Module test: cover every skill once, required skills (min+1) times, then fill. */
export function assembleTest(pool: Question[], m: ModuleDef, seen: Record<string, number>, seed: number): string[] {
  const r = rng(seed);
  const cands = rankBySeen(r, pool.filter((q) => q.module === m.id && usable(q, 'test')), seen);
  const chosen = new Set<string>();
  const take = (pred: (q: Question) => boolean, n: number) => {
    for (const q of cands) {
      if (n <= 0 || chosen.size >= m.test.size) break;
      if (!chosen.has(q.id) && pred(q)) {
        chosen.add(q.id);
        n--;
      }
    }
  };
  for (const req of m.test.require ?? []) take((q) => q.skills.includes(req.skill), req.min + 1);
  for (const k of shuffle(r, m.skills)) take((q) => q.skills.includes(k.id), 1);
  take(() => true, m.test.size);
  return shuffle(r, [...chosen]);
}

export interface ExamScore {
  correct: number;
  total: number;
  byModule: Record<string, [number, number]>;
  bySkill: Record<string, [number, number]>;
  wrong: string[];
}

export function scoreExam(qs: Question[], ok: Record<string, boolean>): ExamScore {
  const byModule: Record<string, [number, number]> = {};
  const bySkill: Record<string, [number, number]> = {};
  const bump = (rec: Record<string, [number, number]>, k: string, good: boolean) => {
    const c = rec[k] ?? [0, 0];
    rec[k] = [c[0] + (good ? 1 : 0), c[1] + 1];
  };
  let correct = 0;
  const wrong: string[] = [];
  for (const q of qs) {
    const good = !!ok[q.id];
    if (good) correct++;
    else wrong.push(q.id);
    bump(byModule, q.module, good);
    for (const k of q.skills) bump(bySkill, k, good);
  }
  return { correct, total: qs.length, byModule, bySkill, wrong };
}

/** Weak areas: anything under 70%, worst first. */
export function weakAreas(by: Record<string, [number, number]>, threshold = 0.7): { id: string; pct: number }[] {
  return Object.entries(by)
    .map(([id, [c, t]]) => ({ id, pct: t ? c / t : 0 }))
    .filter((x) => x.pct < threshold)
    .sort((a, b) => a.pct - b.pct);
}
