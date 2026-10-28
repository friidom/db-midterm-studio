import { describe, expect, it } from 'vitest';
import { checkAnswer, normalizeText, listItems } from '../src/lib/answers';
import type { ModuleDef, Question } from '../src/lib/types';
import {
  emptyState,
  recordAttempt,
  skillStat,
  moduleStatus,
  gradeTest,
  recordTest,
  nextAction,
  checksPassed,
  completeLesson,
  openLesson,
  type Attempt,
  type ProgressState,
} from '../src/lib/progress';
import { apportion, assembleExam, assembleTest, scoreExam, weakAreas } from '../src/lib/exam';
import { runRA, parseRA, sameRelation, RAError } from '../src/lib/ra';
import { relDb } from '../src/content/datasets';
import { openDataset, execQuery, compareResults, translateDialect, pipeline, checkSql } from '../src/lib/sql';

const mcq: Question = {
  id: 'q1', module: 'm1', skills: ['s1'], level: 1, type: 'mcq', prompt: '', explain: '',
  options: ['a', 'b', 'c'], answer: 1, why: ['a is the trap', undefined, undefined],
};

describe('answer checking', () => {
  it('mcq returns option-specific misconception feedback', () => {
    expect(checkAnswer(mcq, { type: 'mcq', choice: 1 }).correct).toBe(true);
    const r = checkAnswer(mcq, { type: 'mcq', choice: 0 });
    expect(r.correct).toBe(false);
    expect(r.feedback).toBe('a is the trap');
  });

  it('multi requires the exact set; partial credit is only a score', () => {
    const q: Question = { ...mcq, type: 'multi', answer: [0, 2] } as Question;
    expect(checkAnswer(q, { type: 'multi', choices: [2, 0] }).correct).toBe(true);
    const part = checkAnswer(q, { type: 'multi', choices: [0] });
    expect(part.correct).toBe(false);
    expect(part.score).toBeCloseTo(0.5);
  });

  it('num tolerates formatting and rejects non-numbers', () => {
    const q: Question = { ...mcq, type: 'num', answer: 3.8, tol: 0.01 } as Question;
    expect(checkAnswer(q, { type: 'num', value: ' 3.80 ' }).correct).toBe(true);
    expect(checkAnswer(q, { type: 'num', value: 'three' }).feedback).toMatch(/number/);
    expect(checkAnswer(q, { type: 'num', value: '3.9' }).correct).toBe(false);
  });

  it('text: exact / list / set modes normalise case, spacing and punctuation', () => {
    const exact: Question = { ...mcq, type: 'text', answer: ['HAVING'] } as Question;
    expect(checkAnswer(exact, { type: 'text', value: '  having. ' }).correct).toBe(true);
    const list: Question = { ...mcq, type: 'text', mode: 'list', answer: ['3 1 4'] } as Question;
    expect(checkAnswer(list, { type: 'text', value: 'page3, page1 → p4' }).correct).toBe(true);
    expect(checkAnswer(list, { type: 'text', value: '1 3 4' }).correct).toBe(false);
    const set: Question = { ...mcq, type: 'text', mode: 'set', answer: ['3 1 4'] } as Question;
    expect(checkAnswer(set, { type: 'text', value: '4,1,3' }).correct).toBe(true);
    expect(normalizeText('“A ≤ B”')).toBe('a <= b');
    expect(listItems('(Y,0,3) (N,3,1)')).toEqual(['y', '0', '3', 'n', '3', '1']);
  });

  it('order compares the full sequence', () => {
    const q: Question = { ...mcq, type: 'order', items: ['FROM', 'WHERE', 'GROUP BY'] } as Question;
    expect(checkAnswer(q, { type: 'order', order: ['FROM', 'WHERE', 'GROUP BY'] }).correct).toBe(true);
    const r = checkAnswer(q, { type: 'order', order: ['WHERE', 'FROM', 'GROUP BY'] });
    expect(r.correct).toBe(false);
    expect(r.score).toBeCloseTo(1 / 3);
  });
});

const M = (id: string, prereqs: string[] = [], extra: Partial<ModuleDef> = {}): ModuleDef => ({
  id, num: Number(id.slice(1)), title: id, short: id.toUpperCase(), week: '', lectures: '', blurb: '', prereqs,
  skills: [{ id: `${id}-a`, label: 'A' }, { id: `${id}-b`, label: 'B' }],
  test: { size: 4, pass: 0.75 }, examWeight: 1, objectives: [], ...extra,
});
const att = (q: string, m: string, skills: string[], ok: boolean, t: number): Attempt => ({ q, m, skills, ok, score: ok ? 1 : 0, t, mode: 'practice', hints: 0 });

describe('progress & mastery', () => {
  it('review queue: wrong answers enter, two consecutive correct answers clear them', () => {
    let s = emptyState();
    s = recordAttempt(s, att('q', 'm1', ['m1-a'], false, 1));
    expect(s.review.q.misses).toBe(1);
    s = recordAttempt(s, att('q', 'm1', ['m1-a'], true, 2));
    expect(s.review.q.streak).toBe(1);
    s = recordAttempt(s, att('q', 'm1', ['m1-a'], false, 3));
    expect(s.review.q.streak).toBe(0);
    s = recordAttempt(s, att('q', 'm1', ['m1-a'], true, 4));
    s = recordAttempt(s, att('q', 'm1', ['m1-a'], true, 5));
    expect(s.review.q).toBeUndefined();
  });

  it('skill stats weight recent attempts more', () => {
    let s = emptyState();
    for (const [i, ok] of [false, false, true, true, true].entries()) s = recordAttempt(s, att(`q${i}`, 'm1', ['k'], ok, i));
    const st = skillStat(s.attempts, 'k');
    expect(st.n).toBe(5);
    expect(st.score).toBeGreaterThan(0.6); // recent successes dominate
    let s2 = emptyState();
    for (const [i, ok] of [true, true, true, false, false].entries()) s2 = recordAttempt(s2, att(`q${i}`, 'm1', ['k'], ok, i));
    expect(skillStat(s2.attempts, 'k').level).toBe('learning');
    expect(skillStat([], 'k').level).toBe('new');
  });

  it('module status: locked → available → in progress → needs review → mastered → needs review', () => {
    const m1 = M('m1');
    const m2 = M('m2', ['m1']);
    let s: ProgressState = emptyState();
    expect(moduleStatus(s, m2, ['l2'])).toBe('locked');
    expect(moduleStatus(s, m1, ['l1'])).toBe('available');
    s = openLesson(s, 'l1', 1);
    expect(moduleStatus(s, m1, ['l1'])).toBe('in-progress');
    // reading a lesson never marks mastery
    s = completeLesson(s, 'l1', 2);
    expect(moduleStatus(s, m1, ['l1'])).toBe('in-progress');
    const fail = gradeTest(m1, [{ ok: true, skills: ['m1-a'] }, { ok: false, skills: ['m1-b'] }, { ok: false, skills: ['m1-a'] }, { ok: true, skills: ['m1-b'] }]);
    expect(fail.passed).toBe(false);
    s = recordTest(s, { module: 'm1', t: 3, correct: fail.correct, total: fail.total, passed: fail.passed, skills: fail.skills, unmet: fail.unmet });
    expect(moduleStatus(s, m1, ['l1'])).toBe('needs-review');
    expect(moduleStatus(s, m2, ['l2'])).toBe('locked');
    const pass = gradeTest(m1, [true, true, true, false].map((ok, i) => ({ ok, skills: [i % 2 ? 'm1-a' : 'm1-b'] })));
    expect(pass.passed).toBe(true);
    s = recordTest(s, { module: 'm1', t: 4, correct: pass.correct, total: pass.total, passed: true, skills: pass.skills, unmet: [] });
    for (let i = 0; i < 3; i++) s = recordAttempt(s, att(`x${i}`, 'm1', ['m1-a', 'm1-b'], true, 10 + i));
    expect(moduleStatus(s, m1, ['l1'])).toBe('mastered');
    expect(moduleStatus(s, m2, ['l2'])).toBe('available');
    for (let i = 0; i < 3; i++) s = recordAttempt(s, att(`y${i}`, 'm1', ['m1-a'], false, 20 + i));
    expect(moduleStatus(s, m1, ['l1'])).toBe('needs-review');
    expect(moduleStatus(s, m2, ['l2'])).toBe('available'); // unlocks are not revoked
  });

  it('required-skill criteria block a pass even with a high score', () => {
    const m = M('m4', [], { test: { size: 5, pass: 0.8, require: [{ skill: 'choose', min: 3, label: 'Layout scenarios' }] } });
    const g = gradeTest(m, [
      { ok: true, skills: ['def'] },
      { ok: true, skills: ['def'] },
      { ok: true, skills: ['choose'] },
      { ok: true, skills: ['choose'] },
      { ok: false, skills: ['choose'] },
    ]);
    expect(g.pct).toBeCloseTo(0.8);
    expect(g.passed).toBe(false);
    expect(g.unmet[0]).toMatch(/Layout scenarios/);
  });

  it('lesson completion needs every quick check answered correctly', () => {
    let s = emptyState();
    s = recordAttempt(s, att('c1', 'm1', [], true, 1));
    expect(checksPassed(s, ['c1', 'c2'])).toBe(false);
    s = recordAttempt(s, att('c2', 'm1', [], false, 2));
    expect(checksPassed(s, ['c1', 'c2'])).toBe(false);
    s = recordAttempt(s, att('c2', 'm1', [], true, 3));
    expect(checksPassed(s, ['c1', 'c2'])).toBe(true);
  });

  it('next action: lesson first, then the module test, then review', () => {
    const mods = [M('m1'), M('m2', ['m1'])];
    const lessons = (m: string) => (m === 'm1' ? [{ id: 'l1', title: 'Intro' }] : [{ id: 'l2', title: 'Next' }]);
    let s = emptyState();
    expect(nextAction(s, mods, lessons, (k) => k).link).toBe('#/lesson/l1');
    s = completeLesson(s, 'l1', 1);
    expect(nextAction(s, mods, lessons, (k) => k).link).toBe('#/test/m1');
    s = recordTest(s, { module: 'm1', t: 2, correct: 1, total: 4, passed: false, skills: {}, unmet: [] });
    expect(nextAction(s, mods, lessons, (k) => k).link).toBe('#/practice/m1');
  });
});

const pool: Question[] = Array.from({ length: 40 }, (_, i) => ({
  ...mcq,
  id: `p${i}`,
  module: `m${(i % 4) + 1}`,
  skills: [`m${(i % 4) + 1}-${i % 3 ? 'a' : 'b'}`],
}));

describe('exam & test assembly / scoring', () => {
  it('apportions by weight and keeps every module', () => {
    const a = apportion(10, { m1: 1, m2: 2, m3: 3, m4: 4 });
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(10);
    expect(Math.min(...Object.values(a))).toBeGreaterThanOrEqual(1);
    expect(a.m4).toBeGreaterThan(a.m1);
  });

  it('assembles a reproducible exam without duplicates, preferring unseen questions', () => {
    const seen = Object.fromEntries(pool.filter((q) => q.module === 'm1').slice(0, 5).map((q) => [q.id, 3]));
    const e1 = assembleExam(pool, { size: 12, weights: { m1: 1, m2: 1, m3: 1, m4: 1 }, seen, seed: 7 });
    const e2 = assembleExam(pool, { size: 12, weights: { m1: 1, m2: 1, m3: 1, m4: 1 }, seen, seed: 7 });
    expect(e1).toEqual(e2);
    expect(new Set(e1).size).toBe(12);
    const m1picked = e1.filter((id) => id.startsWith('p') && pool.find((q) => q.id === id)!.module === 'm1');
    expect(m1picked.every((id) => !seen[id])).toBe(true);
  });

  it('module test covers each skill and only uses that module', () => {
    const m = M('m2', [], { test: { size: 6, pass: 0.8 } });
    const ids = assembleTest(pool, m, {}, 3);
    expect(ids.length).toBe(6);
    const qs = ids.map((id) => pool.find((q) => q.id === id)!);
    expect(qs.every((q) => q.module === 'm2')).toBe(true);
    expect(new Set(qs.flatMap((q) => q.skills))).toEqual(new Set(['m2-a', 'm2-b']));
  });

  it('scores by module and skill and reports weak areas worst-first', () => {
    const qs = pool.slice(0, 8);
    const ok = Object.fromEntries(qs.map((q, i) => [q.id, i < 4]));
    const sc = scoreExam(qs, ok);
    expect(sc.correct).toBe(4);
    expect(sc.total).toBe(8);
    expect(sc.wrong.length).toBe(4);
    expect(Object.values(sc.byModule).every(([c, t]) => t === 2 && c === 1)).toBe(true);
    expect(weakAreas({ a: [1, 4], b: [3, 4], c: [0, 2] }).map((w) => w.id)).toEqual(['c', 'a']);
  });
});

describe('relational algebra engine (Lecture 1 examples)', () => {
  const r35 = relDb('r35');
  const rs = relDb('rs');
  const rsj = relDb('rsj');
  const rows = (src: string, db = rs) => runRA(src, db).rel.rows;

  it('selection and projection with derived attributes', () => {
    expect(rows("σ[a_id='a2'](R)", r35)).toEqual([['a2', 102], ['a2', 103]]);
    expect(rows("σ_{a_id='a2' ∧ b_id>102}(R)", r35)).toEqual([['a2', 103]]);
    const p = runRA("π[b_id-100, a_id](σ[a_id='a2'](R))", r35);
    expect(p.rel.rows).toEqual([[2, 'a2'], [3, 'a2']]);
    expect(p.rel.cols[0].name).toBe('b_id-100');
  });

  it('set operations, product and natural join', () => {
    expect(rows('R ∪ S').length).toBe(5);
    expect(rows('R ∩ S')).toEqual([['a3', 103]]);
    expect(rows('R − S')).toEqual([['a1', 101], ['a2', 102]]);
    expect(rows('R minus S')).toEqual([['a1', 101], ['a2', 102]]);
    expect(rows('R × S').length).toBe(9);
    expect(runRA('R ⋈ S', rsj).rel.rows).toEqual([['a3', 103, 'XXX']]);
    expect(runRA('R ⋈[R.a_id = S.a_id] S', rsj).rel.rows.length).toBe(1);
  });

  it('projection removes duplicates (set semantics)', () => {
    expect(rows('π[a_id](R)', r35)).toEqual([['a1'], ['a2'], ['a3']]);
  });

  it('reports helpful errors', () => {
    expect(() => runRA('R ∪ π[a_id](S)', rs)).toThrow(RAError);
    expect(() => runRA('π[a_id](R × S)', rs)).toThrow(/ambiguous/);
    expect(() => parseRA('σ[a_id=](R)')).toThrow(RAError);
  });

  it('compares relations as sets, matching columns by name', () => {
    const exp = runRA('π[b_id, a_id](R)', rs).rel;
    const got = runRA('π[a_id, b_id](R)', rs).rel;
    expect(sameRelation(exp, got).ok).toBe(true);
    expect(sameRelation(exp, runRA('π[b_id, a_id](S)', rs).rel).ok).toBe(false);
  });
});

describe('SQL engine (sql.js)', () => {
  it('runs the Lecture 2 example (AVG(gpa) = 3.8 for @cs logins)', async () => {
    const db = await openDataset('lecture2');
    const r = execQuery(db, "SELECT AVG(gpa), COUNT(sid) FROM student WHERE login LIKE '%@cs'");
    expect(r.rows[0][0]).toBeCloseTo(3.8);
    expect(r.rows[0][1]).toBe(3);
    // LIKE is case-sensitive, as in standard SQL
    expect(execQuery(db, "SELECT COUNT(*) FROM student WHERE name LIKE 'rza'").rows[0][0]).toBe(0);
    db.close();
  });

  it('diagnoses duplicates, order and missing rows', () => {
    const e = { cols: ['x'], rows: [[1], [2]] };
    expect(compareResults(e, { cols: ['x'], rows: [[2], [1]] }).ok).toBe(true);
    expect(compareResults(e, { cols: ['x'], rows: [[2], [1]] }, true).notes[0]).toMatch(/order/);
    expect(compareResults(e, { cols: ['x'], rows: [[1], [2], [2]] }).notes.join(' ')).toMatch(/duplicates/);
    expect(compareResults(e, { cols: ['x'], rows: [[1]] }).notes.join(' ')).toMatch(/Missing/);
    expect(compareResults(e, { cols: ['x', 'y'], rows: [[1, 1]] }).ok).toBe(false);
  });

  it('translates FETCH FIRST and blocks unsupported syntax with advice', () => {
    expect(translateDialect('SELECT * FROM t ORDER BY a OFFSET 2 ROWS FETCH FIRST 3 ROWS ONLY').sql).toMatch(/LIMIT 3 OFFSET 2$/);
    expect(translateDialect('SELECT * FROM t WHERE x = ANY(SELECT y FROM u)').blocker).toMatch(/IN/);
    expect(translateDialect('SELECT * FROM t, LATERAL (SELECT 1) x').blocker).toMatch(/LATERAL/);
  });

  it('builds the logical-order pipeline FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY', () => {
    const steps = pipeline('SELECT cid, AVG(score) FROM enrolled WHERE score IS NOT NULL GROUP BY cid HAVING COUNT(*) > 1 ORDER BY cid');
    expect(steps?.map((s) => s.label)).toEqual(['FROM / JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'SELECT', 'ORDER BY']);
    expect(pipeline('SELECT 1 UNION SELECT 2')).toBeNull();
  });

  it('grades a query by executing it against the dataset', async () => {
    const q = { id: 's', module: 'm2', skills: [], level: 1 as const, prompt: '', explain: '', type: 'sql' as const, db: 'lecture2', solution: "SELECT name FROM student WHERE sid IN (SELECT sid FROM enrolled WHERE cid = '15-445')" };
    expect((await checkSql(q, "SELECT s.name FROM student s JOIN enrolled e ON s.sid = e.sid WHERE e.cid = '15-445'")).correct).toBe(true);
    const wrong = await checkSql(q, 'SELECT name FROM student');
    expect(wrong.correct).toBe(false);
    expect(wrong.notes.join(' ')).toMatch(/Unexpected/);
    expect((await checkSql(q, 'SELEC nonsense')).error).toBeTruthy();
  });
});
