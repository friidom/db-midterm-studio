// Real SQL execution with sql.js (SQLite compiled to WebAssembly) — runs locally in the browser.
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import { datasetSql } from '../content/datasets';
import type { CheckResult, Question } from './types';
import type { Val } from './ra';

let locate: ((file: string) => string) | undefined;
let sqlP: Promise<SqlJsStatic> | null = null;

/** Browser entry point passes the bundled wasm URL; tests (Node) use sql.js’s default lookup. */
export function configureSql(fn: (file: string) => string) {
  locate = fn;
}

export const loadSql = () => (sqlP ??= initSqlJs(locate ? { locateFile: locate } : undefined));

export async function openDataset(id: string): Promise<Database> {
  const SQL = await loadSql();
  const db = new SQL.Database();
  // LIKE is case-sensitive in standard SQL / PostgreSQL; make SQLite behave the same way.
  db.run('PRAGMA case_sensitive_like = ON;');
  db.run(datasetSql(id));
  return db;
}

export interface QResult {
  cols: string[];
  rows: Val[][];
}

/** Runs every statement; returns the last result set (empty for DDL/DML). */
export function execQuery(db: Database, sql: string): QResult {
  const res = db.exec(sql);
  if (!res.length) return { cols: [], rows: [] };
  const last = res[res.length - 1];
  return { cols: last.columns, rows: last.values as Val[][] };
}

/** Translate the slide syntax SQLite lacks; explain what cannot be translated. */
export function translateDialect(sql: string): { sql: string; notes: string[]; blocker?: string } {
  const notes: string[] = [];
  let out = sql;
  if (/\bWITH\s+TIES\b/i.test(out))
    return { sql, notes, blocker: 'FETCH … WITH TIES is not supported by SQLite (the engine used here). Remove WITH TIES, or reason about ties by hand.' };
  const off = /\bOFFSET\s+(\d+)\s+ROWS?\b/i.exec(out);
  const fetch = /\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/i.exec(out);
  if (fetch || off) {
    out = out.replace(/\bOFFSET\s+\d+\s+ROWS?\b/i, '').replace(/\bFETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY\b/i, '');
    out = out.replace(/;?\s*$/, '') + ` LIMIT ${fetch ? fetch[1] : -1}${off ? ` OFFSET ${off[1]}` : ''}`;
    notes.push('SQLite has no FETCH FIRST / OFFSET … ROWS, so this was run as LIMIT/OFFSET (same meaning).');
  }
  if (/\b(ANY|SOME|ALL)\s*\(\s*SELECT/i.test(out))
    return {
      sql,
      notes,
      blocker:
        'SQLite does not support = ANY(…) / > ALL(…). Rewrite: “x = ANY (subquery)” is the same as “x IN (subquery)”; “x > ALL (subquery)” can be written “x > (SELECT MAX(…) …)” or with NOT EXISTS.',
    };
  if (/\bLATERAL\b/i.test(out)) return { sql, notes, blocker: 'SQLite does not support LATERAL joins. Use a correlated subquery in the SELECT list, or GROUP BY with a LEFT JOIN.' };
  if (/\bSELECT\b[\s\S]*\bINTO\s+\w+\s+FROM\b/i.test(out)) return { sql, notes, blocker: 'SQLite does not support SELECT … INTO. Use CREATE TABLE t AS SELECT … (or INSERT INTO t SELECT …).' };
  return { sql: out, notes };
}

const norm = (v: Val): Val => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
const rowKey = (r: Val[]) => JSON.stringify(r.map(norm));
const fmtRow = (k: string) => `(${(JSON.parse(k) as Val[]).map((v) => (v === null ? 'NULL' : v)).join(', ')})`;

function multiset(rows: Val[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(rowKey(r), (m.get(rowKey(r)) ?? 0) + 1);
  return m;
}

export function compareResults(expected: QResult, got: QResult, ordered = false): { ok: boolean; notes: string[] } {
  if (expected.cols.length !== got.cols.length)
    return {
      ok: false,
      notes: [`Your query returns ${got.cols.length} column(s) (${got.cols.join(', ') || 'none'}); the expected result has ${expected.cols.length} (${expected.cols.join(', ')}).`],
    };
  const E = multiset(expected.rows);
  const G = multiset(got.rows);
  const same = E.size === G.size && [...E].every(([k, n]) => G.get(k) === n);
  if (same) {
    if (!ordered) return { ok: true, notes: [] };
    const inOrder = expected.rows.every((r, i) => rowKey(r) === rowKey(got.rows[i]));
    return inOrder ? { ok: true, notes: [] } : { ok: false, notes: ['You return the right rows, but in the wrong order. This question asks for a specific ORDER BY.'] };
  }
  const notes: string[] = [`Expected ${expected.rows.length} row(s); your query returned ${got.rows.length}.`];
  const eKeys = new Set(E.keys());
  const gKeys = new Set(G.keys());
  const missing = [...eKeys].filter((k) => !gKeys.has(k));
  const extra = [...gKeys].filter((k) => !eKeys.has(k));
  if (!missing.length && !extra.length) {
    const dupMore = [...G].some(([k, n]) => n > (E.get(k) ?? 0));
    notes.push(
      dupMore
        ? 'Same rows, but you have extra duplicates. SQL keeps duplicates (bag semantics) — do you need DISTINCT, or did a join multiply rows?'
        : 'Same distinct rows, but you are missing duplicates. Did you use DISTINCT (or UNION) where duplicates should stay (UNION ALL)?',
    );
  } else {
    if (missing.length) notes.push(`Missing row(s): ${missing.slice(0, 4).map(fmtRow).join(' ')}${missing.length > 4 ? ' …' : ''}.`);
    if (extra.length) notes.push(`Unexpected row(s): ${extra.slice(0, 4).map(fmtRow).join(' ')}${extra.length > 4 ? ' …' : ''}.`);
    if (extra.length && !missing.length) notes.push('Every expected row is there, plus more → a filter (WHERE / HAVING) is missing or too loose.');
    if (missing.length && !extra.length) notes.push('You only return a subset → a filter is too strict, or an inner join dropped rows that should stay (LEFT JOIN?).');
    const nulls = (ks: string[]) => ks.some((k) => k.includes('null'));
    if (nulls(missing) || nulls(extra)) notes.push('NULLs are involved: comparisons with NULL are UNKNOWN, so WHERE drops them; use IS NULL / IS NOT NULL, and remember COUNT(col) skips NULLs.');
  }
  return { ok: false, notes };
}

/* ---------- logical evaluation order (FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY) ---------- */

type ClauseName = 'select' | 'from' | 'where' | 'group' | 'having' | 'order' | 'limit';

/** Split a single SELECT statement at top-level clause keywords. Returns null for shapes it cannot handle. */
export function splitClauses(sql: string): Partial<Record<ClauseName, string>> | null {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(s)) return null;
  const marks: { name: ClauseName; at: number; len: number }[] = [];
  const kws: [ClauseName, RegExp][] = [
    ['select', /^select\b/i],
    ['from', /^from\b/i],
    ['where', /^where\b/i],
    ['group', /^group\s+by\b/i],
    ['having', /^having\b/i],
    ['order', /^order\s+by\b/i],
    ['limit', /^limit\b/i],
  ];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (i === 0 || /\s/.test(s[i - 1]))) {
      const rest = s.slice(i);
      if (/^(union|intersect|except)\b/i.test(rest)) return null;
      for (const [name, re] of kws) {
        const m = re.exec(rest);
        if (m) {
          if (name === 'select' && i !== 0) return null;
          marks.push({ name, at: i, len: m[0].length });
          break;
        }
      }
    }
  }
  const out: Partial<Record<ClauseName, string>> = {};
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].at : s.length;
    out[m.name] = s.slice(m.at + m.len, end).trim();
  });
  if (!out.from) return null;
  return out;
}

const AGG = /\b(count|sum|avg|min|max|group_concat)\s*\(/i;

export interface PipelineStep {
  label: string;
  detail: string;
  sql: string;
}

export function pipeline(sql: string): PipelineStep[] | null {
  const c = splitClauses(sql);
  if (!c || !c.select) return null;
  const steps: PipelineStep[] = [];
  const from = `FROM ${c.from}`;
  const where = c.where ? ` WHERE ${c.where}` : '';
  steps.push({ label: 'FROM / JOIN', detail: 'Build the input rows (joins pair up rows from the listed tables).', sql: `SELECT * ${from}` });
  if (c.where) steps.push({ label: 'WHERE', detail: 'Keep only rows whose condition is TRUE. FALSE and UNKNOWN (NULL comparisons) are dropped. Runs before any grouping.', sql: `SELECT * ${from}${where}` });
  const hasAgg = AGG.test(c.select) || (c.having ? AGG.test(c.having) : false);
  if (c.group) {
    steps.push({
      label: 'GROUP BY',
      detail: `Form one group per distinct value of (${c.group}). Every output row will describe one group.`,
      sql: `SELECT ${c.group}, COUNT(*) AS rows_in_group ${from}${where} GROUP BY ${c.group}`,
    });
    if (c.having)
      steps.push({
        label: 'HAVING',
        detail: 'Keep only groups whose aggregate condition is TRUE (WHERE filters rows; HAVING filters groups).',
        sql: `SELECT ${c.group}, COUNT(*) AS rows_in_group ${from}${where} GROUP BY ${c.group} HAVING ${c.having}`,
      });
  } else if (hasAgg) {
    steps.push({ label: 'Aggregate (one group)', detail: 'No GROUP BY but aggregates are used, so all remaining rows form one single group → one output row.', sql: `SELECT COUNT(*) AS rows_in_group ${from}${where}` });
  }
  const tail = `${c.group ? ` GROUP BY ${c.group}` : ''}${c.having ? ` HAVING ${c.having}` : ''}`;
  steps.push({
    label: /^distinct\b/i.test(c.select) ? 'SELECT DISTINCT' : 'SELECT',
    detail: /^distinct\b/i.test(c.select) ? 'Compute the output columns, then remove duplicate rows.' : 'Compute the output columns (aggregates are evaluated per group). Duplicates are kept.',
    sql: `SELECT ${c.select} ${from}${where}${tail}`,
  });
  if (c.order || c.limit)
    steps.push({ label: [c.order && 'ORDER BY', c.limit && 'LIMIT'].filter(Boolean).join(' / '), detail: 'Sort the final rows and/or cut the output. This is the last step.', sql: sql.trim().replace(/;\s*$/, '') });
  return steps;
}

/* ---------- grading ---------- */

export interface SqlCheck extends CheckResult {
  expectedResult?: QResult;
  got?: QResult;
  error?: string;
  notes: string[];
}

export async function checkSql(q: Extract<Question, { type: 'sql' }>, query: string): Promise<SqlCheck> {
  const db = await openDataset(q.db);
  try {
    const expectedResult = execQuery(db, q.solution);
    if (!query.trim()) return { correct: false, score: 0, notes: ['Write a query first.'], expectedResult, expected: q.solution };
    const tr = translateDialect(query);
    if (tr.blocker) return { correct: false, score: 0, error: tr.blocker, notes: [], expectedResult, expected: q.solution };
    const db2 = await openDataset(q.db);
    try {
      const got = execQuery(db2, tr.sql);
      const cmp = compareResults(expectedResult, got, q.ordered);
      return { correct: cmp.ok, score: cmp.ok ? 1 : 0, notes: [...tr.notes, ...cmp.notes], expectedResult, got, expected: q.solution, feedback: cmp.notes.join(' ') };
    } catch (e) {
      return { correct: false, score: 0, error: (e as Error).message, notes: tr.notes, expectedResult, expected: q.solution };
    } finally {
      db2.close();
    }
  } finally {
    db.close();
  }
}
