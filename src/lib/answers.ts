import type { CheckResult, Question, Response } from './types';

/** Normalise free text: case, whitespace, quotes, unicode dashes/operators. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[.;]+$/, '')
    .trim();
}

/** Split a list answer ("3, 1 4; 2") into normalised items. */
export function listItems(s: string): string[] {
  return normalizeText(s)
    .replace(/[()[\]{}]/g, ' ')
    .split(/[\s,;→>]+|->/)
    .map((x) => x.replace(/^(page|p)(?=\d)/, ''))
    .filter(Boolean);
}

export function parseNumber(s: string): number | null {
  const cleaned = s.trim().replace(/,/g, '').replace(/[a-z%]+$/i, '').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Human-readable correct answer for feedback. */
export function expectedText(q: Question): string {
  switch (q.type) {
    case 'mcq':
      return q.options[q.answer];
    case 'multi':
      return q.answer.map((i) => q.options[i]).join(' · ');
    case 'num':
      return `${q.answer}${q.unit ? ' ' + q.unit : ''}`;
    case 'text':
      return q.answer[0];
    case 'order':
      return q.items.join(' → ');
    case 'sql':
      return q.solution;
    case 'ra':
      return q.solution;
    case 'trace':
      return 'see the step-by-step trace';
  }
}

/**
 * Synchronous checking for every type except `sql` (needs the SQL engine, see sql.ts)
 * and `ra` (needs relations, see ra.ts → checkRa).
 */
export function checkAnswer(q: Question, r: Response): CheckResult {
  const expected = expectedText(q);
  if (q.type !== r.type) return { correct: false, score: 0, expected, feedback: 'Answer type mismatch.' };
  switch (q.type) {
    case 'mcq': {
      const choice = (r as { choice: number }).choice;
      const ok = choice === q.answer;
      return { correct: ok, score: ok ? 1 : 0, expected, feedback: ok ? undefined : q.why?.[choice] };
    }
    case 'multi': {
      const choices = (r as { choices: number[] }).choices;
      const ok = sameSet(choices, q.answer);
      const wrongPicks = choices.filter((c) => !q.answer.includes(c));
      const missed = q.answer.filter((c) => !choices.includes(c));
      const fb = [
        ...wrongPicks.map((c) => q.why?.[c] ?? `“${q.options[c]}” should not be selected.`),
        ...missed.map((c) => `You missed: “${q.options[c]}”.`),
      ].join(' ');
      // partial credit is reported but only a fully correct selection counts as correct
      const score = Math.max(0, (q.answer.length - missed.length - wrongPicks.length) / q.answer.length);
      return { correct: ok, score: ok ? 1 : score, expected, feedback: ok ? undefined : fb };
    }
    case 'num': {
      const v = parseNumber((r as { value: string }).value);
      if (v === null) return { correct: false, score: 0, expected, feedback: 'Please enter a number.' };
      const ok = Math.abs(v - q.answer) <= (q.tol ?? 1e-9);
      return { correct: ok, score: ok ? 1 : 0, expected };
    }
    case 'text': {
      const raw = (r as { value: string }).value;
      const mode = q.mode ?? 'exact';
      let ok: boolean;
      if (mode === 'exact') ok = q.answer.some((a) => normalizeText(a) === normalizeText(raw));
      else if (mode === 'list') ok = q.answer.some((a) => listItems(a).join(',') === listItems(raw).join(','));
      else ok = q.answer.some((a) => listItems(a).sort().join(',') === listItems(raw).sort().join(','));
      return { correct: ok, score: ok ? 1 : 0, expected };
    }
    case 'order': {
      const order = (r as { order: string[] }).order;
      const ok = order.length === q.items.length && order.every((x, i) => x === q.items[i]);
      const inPlace = order.filter((x, i) => x === q.items[i]).length;
      return { correct: ok, score: inPlace / q.items.length, expected };
    }
    case 'trace': {
      const score = (r as { score: number }).score;
      return { correct: score >= 0.8, score, expected };
    }
    case 'sql':
    case 'ra':
      throw new Error(`${q.type} answers are checked asynchronously`);
  }
}

/** Short summary of a response for the mistakes log. */
export function describeResponse(q: Question, r: Response): string {
  switch (r.type) {
    case 'mcq':
      return q.type === 'mcq' ? q.options[r.choice] ?? '—' : '—';
    case 'multi':
      return q.type === 'multi' ? r.choices.map((c) => q.options[c]).join(' · ') || '(nothing selected)' : '—';
    case 'num':
    case 'text':
      return r.value || '(blank)';
    case 'order':
      return r.order.join(' → ');
    case 'sql':
      return r.query;
    case 'ra':
      return r.expr;
    case 'trace':
      return `${Math.round(r.score * 100)}% of steps correct`;
  }
}
