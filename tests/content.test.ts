import { describe, expect, it } from 'vitest';
import { validateContent, QUESTIONS, LESSONS, lessonChecks } from '../src/content';
import { MODULES } from '../src/content/modules';
import { relDb } from '../src/content/datasets';
import { runRA } from '../src/lib/ra';
import { openDataset, execQuery } from '../src/lib/sql';
import { buildTrace, checkAsk } from '../src/lib/trace';
import { checkAnswer, expectedText } from '../src/lib/answers';

describe('course content', () => {
  it('passes structural validation (ids, sources, checks, test pools, mastery requirements)', () => {
    expect(validateContent()).toEqual([]);
  });

  it('covers every module with substantive lessons and questions', () => {
    for (const m of MODULES) {
      const ls = LESSONS.filter((l) => l.module === m.id);
      expect(ls.length, m.id).toBeGreaterThanOrEqual(3);
      for (const l of ls) expect(l.blocks.length, l.id).toBeGreaterThan(0);
      expect(QUESTIONS.filter((q) => q.module === m.id).length, m.id).toBeGreaterThanOrEqual(12);
    }
    expect(LESSONS.flatMap(lessonChecks).length).toBeGreaterThan(40);
  });

  it('every SQL solution runs on its dataset and returns rows', async () => {
    for (const q of QUESTIONS) {
      if (q.type !== 'sql') continue;
      const db = await openDataset(q.db);
      const r = execQuery(db, q.solution);
      expect(r.rows.length, q.id).toBeGreaterThan(0);
      db.close();
    }
  });

  it('every relational algebra solution evaluates', () => {
    for (const q of QUESTIONS) if (q.type === 'ra') expect(runRA(q.solution, relDb(q.db)).rel.rows.length, q.id).toBeGreaterThan(0);
  });

  it('every trace question builds and its own answers are accepted', () => {
    for (const q of QUESTIONS) {
      if (q.type !== 'trace') continue;
      const steps = buildTrace(q.trace);
      expect(steps.length, q.id).toBeGreaterThan(0);
      for (const s of steps) for (const a of s.asks) expect(checkAsk(a, a.answer), `${q.id}: ${a.label}`).toBe(true);
    }
  });

  it('the stored correct answer of every auto-graded question is accepted by the checker', () => {
    for (const q of QUESTIONS) {
      if (q.type === 'mcq') expect(checkAnswer(q, { type: 'mcq', choice: q.answer }).correct, q.id).toBe(true);
      if (q.type === 'multi') expect(checkAnswer(q, { type: 'multi', choices: q.answer }).correct, q.id).toBe(true);
      if (q.type === 'num') expect(checkAnswer(q, { type: 'num', value: String(q.answer) }).correct, q.id).toBe(true);
      if (q.type === 'text') expect(checkAnswer(q, { type: 'text', value: expectedText(q) }).correct, q.id).toBe(true);
      if (q.type === 'order') expect(checkAnswer(q, { type: 'order', order: q.items }).correct, q.id).toBe(true);
    }
  });
});
