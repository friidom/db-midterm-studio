import type { Block, Lesson, Question } from '../lib/types';
import { fromGeneratedId } from '../lib/generators';
import { MODULES } from './modules';
import * as m1 from './m1';
import * as m2 from './m2';
import * as m3 from './m3';
import * as m4 from './m4';
import * as m5 from './m5';
import * as m6 from './m6';
import * as m7 from './m7';
import * as m8 from './m8';

const parts = [m1, m2, m3, m4, m5, m6, m7, m8];
export const LESSONS: Lesson[] = parts.flatMap((p) => p.lessons);
export const QUESTIONS: Question[] = parts.flatMap((p) => p.questions);

const qMap = new Map(QUESTIONS.map((q) => [q.id, q]));
export const getQuestion = (id: string): Question | undefined => qMap.get(id) ?? fromGeneratedId(id) ?? undefined;
export const lessonsOf = (m: string) => LESSONS.filter((l) => l.module === m);
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);

function checksIn(blocks: Block[]): string[] {
  return blocks.flatMap((b) => {
    if (b.k === 'check') return [b.q];
    if (b.k === 'concept') return [...(b.c.check ? [b.c.check] : []), ...checksIn(b.c.example ?? [])];
    return [];
  });
}
export const lessonChecks = (l: Lesson) => checksIn(l.blocks);

/** Static consistency checks — run by the test suite. */
export function validateContent(): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const q of QUESTIONS) {
    if (ids.has(q.id)) errs.push(`duplicate question id ${q.id}`);
    ids.add(q.id);
    const mod = MODULES.find((m) => m.id === q.module);
    if (!mod) errs.push(`${q.id}: unknown module ${q.module}`);
    for (const k of q.skills) if (!mod?.skills.some((s) => s.id === k)) errs.push(`${q.id}: skill ${k} not in ${q.module}`);
    if (q.follow && !qMap.has(q.follow)) errs.push(`${q.id}: follow-up ${q.follow} missing`);
    if (q.type === 'mcq' && (q.answer < 0 || q.answer >= q.options.length)) errs.push(`${q.id}: answer out of range`);
    if (q.type === 'multi' && q.answer.some((a) => a < 0 || a >= q.options.length)) errs.push(`${q.id}: answer out of range`);
    if (!q.explain) errs.push(`${q.id}: missing explanation`);
  }
  const lids = new Set<string>();
  for (const l of LESSONS) {
    if (lids.has(l.id)) errs.push(`duplicate lesson ${l.id}`);
    lids.add(l.id);
    if (!l.sources.length) errs.push(`${l.id}: no sources`);
    const checks = lessonChecks(l);
    if (!checks.length) errs.push(`${l.id}: no quick checks`);
    for (const c of checks) if (!qMap.has(c)) errs.push(`${l.id}: check ${c} missing`);
  }
  for (const m of MODULES) {
    if (!LESSONS.some((l) => l.module === m.id)) errs.push(`${m.id}: no lessons`);
    for (const s of m.skills) if (s.lesson && !lids.has(s.lesson)) errs.push(`${m.id}: skill lesson ${s.lesson} missing`);
    const testable = QUESTIONS.filter((q) => q.module === m.id && (q.use ?? ['practice', 'test', 'exam']).includes('test'));
    if (testable.length < m.test.size) errs.push(`${m.id}: only ${testable.length} test questions for a ${m.test.size}-question test`);
    for (const r of m.test.require ?? []) if (testable.filter((q) => q.skills.includes(r.skill)).length < r.min + 1) errs.push(`${m.id}: not enough ${r.skill} questions`);
  }
  return errs;
}
