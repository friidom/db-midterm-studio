import type { ModuleDef } from './types';

export type Mode = 'check' | 'practice' | 'test' | 'exam' | 'review';

export interface Attempt {
  q: string;
  m: string; // module id
  skills: string[];
  ok: boolean;
  score: number;
  t: number;
  mode: Mode;
  hints: number;
  resp?: string;
}

export interface ReviewItem {
  q: string;
  added: number;
  last: number;
  streak: number; // consecutive correct answers since the last mistake
  misses: number;
  resp?: string; // the learner's last wrong answer
}

export interface TestRecord {
  module: string;
  t: number;
  correct: number;
  total: number;
  passed: boolean;
  skills: Record<string, [number, number]>;
  unmet: string[];
}

export interface ExamRecord {
  id: string;
  t: number;
  format: string;
  correct: number;
  total: number;
  secs: number;
  byModule: Record<string, [number, number]>;
  qids: string[];
  wrong: string[];
}

export interface Activity {
  t: number;
  kind: 'lesson' | 'practice' | 'test' | 'exam' | 'review' | 'check';
  label: string;
  link?: string;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
}

export interface ProgressState {
  v: 1;
  lessons: Record<string, { opened?: number; done?: number }>;
  attempts: Attempt[];
  review: Record<string, ReviewItem>;
  tests: TestRecord[];
  exams: ExamRecord[];
  passed: Record<string, number>; // module id → first time the module test was passed
  activity: Activity[];
  settings: Settings;
}

export const emptyState = (): ProgressState => ({
  v: 1,
  lessons: {},
  attempts: [],
  review: {},
  tests: [],
  exams: [],
  passed: {},
  activity: [],
  settings: { theme: 'system' },
});

const MAX_ATTEMPTS = 6000;
const MAX_ACTIVITY = 60;
/** A question leaves the review queue after this many consecutive correct answers. */
export const REVIEW_CLEAR_STREAK = 2;

export function logActivity(s: ProgressState, a: Activity): ProgressState {
  return { ...s, activity: [a, ...s.activity].slice(0, MAX_ACTIVITY) };
}

export function recordAttempt(s: ProgressState, a: Attempt): ProgressState {
  const attempts = [...s.attempts, a].slice(-MAX_ATTEMPTS);
  const review = { ...s.review };
  const cur = review[a.q];
  if (!a.ok) {
    review[a.q] = {
      q: a.q,
      added: cur?.added ?? a.t,
      last: a.t,
      streak: 0,
      misses: (cur?.misses ?? 0) + 1,
      resp: a.resp,
    };
  } else if (cur) {
    const streak = cur.streak + 1;
    if (streak >= REVIEW_CLEAR_STREAK) delete review[a.q];
    else review[a.q] = { ...cur, streak, last: a.t };
  }
  return { ...s, attempts, review };
}

export function openLesson(s: ProgressState, id: string, t: number): ProgressState {
  if (s.lessons[id]?.opened) return s;
  return { ...s, lessons: { ...s.lessons, [id]: { ...s.lessons[id], opened: t } } };
}

export function completeLesson(s: ProgressState, id: string, t: number): ProgressState {
  if (s.lessons[id]?.done) return s;
  return { ...s, lessons: { ...s.lessons, [id]: { opened: s.lessons[id]?.opened ?? t, done: t } } };
}

/** Lesson completion = every quick check in the lesson has been answered correctly at least once. */
export function checksPassed(s: ProgressState, checkIds: string[]): boolean {
  const ok = new Set(s.attempts.filter((a) => a.ok).map((a) => a.q));
  return checkIds.every((id) => ok.has(id));
}

export type SkillLevel = 'new' | 'learning' | 'developing' | 'strong';

export interface SkillStat {
  n: number; // attempts in the window
  correct: number;
  score: number; // recency-weighted accuracy 0..1
  level: SkillLevel;
  total: number; // all-time attempts
}

const WINDOW = 8;
const DECAY = 0.7;

/** Recency-weighted accuracy over the most recent attempts on a skill. */
export function skillStat(attempts: Attempt[], skill: string): SkillStat {
  const all = attempts.filter((a) => a.skills.includes(skill));
  const recent = all.slice(-WINDOW).reverse(); // most recent first
  if (recent.length === 0) return { n: 0, correct: 0, score: 0, level: 'new', total: 0 };
  let w = 1,
    num = 0,
    den = 0;
  for (const a of recent) {
    num += w * a.score;
    den += w;
    w *= DECAY;
  }
  const score = num / den;
  const correct = recent.filter((a) => a.ok).length;
  const level: SkillLevel = score < 0.6 ? 'learning' : score >= 0.85 && recent.length >= 3 ? 'strong' : 'developing';
  return { n: recent.length, correct, score, level, total: all.length };
}

export const isWeak = (st: SkillStat) => st.n >= 2 && st.score < 0.6;

export function weakSkills(s: ProgressState, skills: string[]): string[] {
  return skills.filter((k) => isWeak(skillStat(s.attempts, k)));
}

export const isUnlocked = (s: ProgressState, m: ModuleDef) => m.prereqs.every((p) => !!s.passed[p]);

export type ModuleStatus = 'locked' | 'available' | 'in-progress' | 'needs-review' | 'mastered';

export function lastTest(s: ProgressState, moduleId: string): TestRecord | undefined {
  for (let i = s.tests.length - 1; i >= 0; i--) if (s.tests[i].module === moduleId) return s.tests[i];
  return undefined;
}

export function moduleStatus(s: ProgressState, m: ModuleDef, lessonIds: string[]): ModuleStatus {
  if (!isUnlocked(s, m)) return 'locked';
  const weak = weakSkills(
    s,
    m.skills.map((k) => k.id),
  );
  if (s.passed[m.id]) return weak.length ? 'needs-review' : 'mastered';
  const lt = lastTest(s, m.id);
  if (lt && !lt.passed) return 'needs-review';
  const touched = lessonIds.some((id) => s.lessons[id]?.opened) || s.attempts.some((a) => a.m === m.id);
  return touched ? 'in-progress' : 'available';
}

export function lessonCompletion(s: ProgressState, lessonIds: string[]): number {
  if (!lessonIds.length) return 0;
  return lessonIds.filter((id) => s.lessons[id]?.done).length / lessonIds.length;
}

/** Demonstrated mastery: mean recency-weighted score over the module's skills (unseen skills count as 0). */
export function moduleMastery(s: ProgressState, m: ModuleDef): number {
  if (!m.skills.length) return 0;
  const sum = m.skills.reduce((acc, k) => acc + skillStat(s.attempts, k.id).score, 0);
  return sum / m.skills.length;
}

export interface GradedItem {
  ok: boolean;
  skills: string[];
}

export interface TestGrade {
  correct: number;
  total: number;
  pct: number;
  passed: boolean;
  skills: Record<string, [number, number]>;
  unmet: string[];
}

/** Mastery criteria: overall score ≥ pass AND every required skill has ≥ min correct answers. */
export function gradeTest(m: ModuleDef, items: GradedItem[]): TestGrade {
  const skills: Record<string, [number, number]> = {};
  let correct = 0;
  for (const it of items) {
    if (it.ok) correct++;
    for (const k of it.skills) {
      const cur = skills[k] ?? [0, 0];
      skills[k] = [cur[0] + (it.ok ? 1 : 0), cur[1] + 1];
    }
  }
  const total = items.length;
  const pct = total ? correct / total : 0;
  const unmet: string[] = [];
  if (pct < m.test.pass) unmet.push(`Score at least ${Math.round(m.test.pass * 100)}% (you scored ${Math.round(pct * 100)}%)`);
  for (const r of m.test.require ?? []) {
    const got = skills[r.skill]?.[0] ?? 0;
    if (got < r.min) unmet.push(`${r.label}: need ${r.min} correct, got ${got}`);
  }
  return { correct, total, pct, passed: total > 0 && unmet.length === 0, skills, unmet };
}

export function recordTest(s: ProgressState, rec: TestRecord): ProgressState {
  const passed = rec.passed && !s.passed[rec.module] ? { ...s.passed, [rec.module]: rec.t } : s.passed;
  return { ...s, tests: [...s.tests, rec], passed };
}

export function recordExam(s: ProgressState, rec: ExamRecord): ProgressState {
  return { ...s, exams: [...s.exams, rec] };
}

/** How many times each question has appeared in exams/tests — used to avoid repeats. */
export function seenCounts(s: ProgressState): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const a of s.attempts) seen[a.q] = (seen[a.q] ?? 0) + 1;
  for (const e of s.exams) for (const q of e.qids) seen[q] = (seen[q] ?? 0) + 1;
  return seen;
}

export interface NextAction {
  title: string;
  detail: string;
  link: string;
  cta: string;
}

export function nextAction(
  s: ProgressState,
  modules: ModuleDef[],
  lessonsOf: (m: string) => { id: string; title: string }[],
  labelOfSkill: (k: string) => string,
): NextAction {
  const queue = Object.keys(s.review).length;
  if (queue >= 5)
    return {
      title: `Clear your review queue (${queue} questions)`,
      detail: 'These are questions you got wrong recently. Each one leaves the queue after two correct answers in a row.',
      link: '#/review',
      cta: 'Start review',
    };
  const ordered = [...modules].sort((a, b) => a.num - b.num);
  for (const m of ordered) {
    const lt = lastTest(s, m.id);
    if (!s.passed[m.id] && lt && !lt.passed && isUnlocked(s, m)) {
      const weak = weakSkills(s, m.skills.map((k) => k.id));
      return {
        title: `Strengthen ${m.short}, then retake its test`,
        detail: weak.length
          ? `Weak skills: ${weak.map(labelOfSkill).join(', ')}.`
          : `Your last test score was ${lt.correct}/${lt.total}. Practise first, then retake it.`,
        link: `#/practice/${m.id}`,
        cta: 'Targeted practice',
      };
    }
  }
  for (const m of ordered) {
    if (!isUnlocked(s, m) || s.passed[m.id]) continue;
    const next = lessonsOf(m.id).find((l) => !s.lessons[l.id]?.done);
    if (next)
      return {
        title: `Continue ${m.short}: ${next.title}`,
        detail: 'Finish the lesson’s quick checks to complete it. Then practise and take the module test.',
        link: `#/lesson/${next.id}`,
        cta: s.lessons[next.id]?.opened ? 'Continue lesson' : 'Start lesson',
      };
    return {
      title: `Take the ${m.short} module test`,
      detail: `All lessons are complete. Pass the test (≥ ${Math.round(m.test.pass * 100)}%) to master the module and unlock what depends on it.`,
      link: `#/test/${m.id}`,
      cta: 'Start test',
    };
  }
  const weakMods = ordered.filter((m) => weakSkills(s, m.skills.map((k) => k.id)).length);
  if (weakMods.length)
    return {
      title: `Review ${weakMods[0].short}`,
      detail: 'You recently made mistakes on skills in this mastered module.',
      link: `#/practice/${weakMods[0].id}`,
      cta: 'Targeted practice',
    };
  if (queue)
    return { title: `Review ${queue} recent mistake${queue > 1 ? 's' : ''}`, detail: 'Close the loop on what you missed.', link: '#/review', cta: 'Start review' };
  return {
    title: 'Take a full practice midterm',
    detail: 'Every unlocked module is mastered. Test yourself under exam conditions.',
    link: '#/exam',
    cta: 'Open exam mode',
  };
}
