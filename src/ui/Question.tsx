import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question, Response } from '../lib/types';
import type { Mode } from '../lib/progress';
import { checkAnswer, describeResponse, expectedText } from '../lib/answers';
import { checkSql, openDataset, execQuery, translateDialect, pipeline, type QResult, type SqlCheck } from '../lib/sql';
import { runRA, raSteps, sameRelation, colLabels, RAError, type RANode } from '../lib/ra';
import { dataset, relDb } from '../content/datasets';
import { getQuestion } from '../content';
import { rng, shuffle } from '../lib/random';
import { recordAnswer } from '../store';
import { Code, Icon, Md, RelTable } from './kit';
import { Blocks } from './Blocks';
import { TraceRunner } from './views';
import { SKILL_LABEL } from '../content/modules';

export interface QResultInfo {
  ok: boolean;
  score: number;
  resp: Response;
  summary: string;
}

interface Props {
  q: Question;
  mode: Mode;
  record?: boolean;
  exam?: boolean; // deferred feedback (exam mode)
  onResult?: (r: QResultInfo) => void;
  onNext?: () => void;
  nextLabel?: string;
  compact?: boolean;
}

const hashSeed = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function QuestionCard({ q, mode, record = true, exam, onResult, onNext, nextLabel, compact }: Props) {
  const single = mode === 'test' || mode === 'exam';
  const [choice, setChoice] = useState<number | null>(null);
  const [multi, setMulti] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [order, setOrder] = useState<string[]>(() => {
    if (q.type !== 'order') return [];
    let o = shuffle(rng(hashSeed(q.id)), q.items);
    if (o.join() === q.items.join()) o = [...o.slice(1), o[0]];
    return o;
  });
  const [hints, setHints] = useState(0);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; feedback?: string; sql?: SqlCheck; ra?: { node?: RANode; err?: string; msg?: string } } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(false);
  const [traceKey, setTraceKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'test' && mode !== 'exam') return;
    cardRef.current?.querySelector<HTMLElement>('button.opt, input, textarea')?.focus();
  }, [q.id, mode]);

  const answered = result !== null;
  const canRetry = !single && answered && !result.ok && !revealed;
  const locked = answered && (single || result.ok || revealed);

  const finish = (ok: boolean, resp: Response, extra: Partial<NonNullable<typeof result>> = {}, scoreIn?: number) => {
    const base = scoreIn ?? (ok ? 1 : 0);
    const score = ok ? (tries > 0 ? Math.min(base, 0.6) : hints > 0 ? Math.min(base, 0.7) : base) : base * 0.5;
    setResult({ ok, ...extra });
    setTries((t) => t + 1);
    const summary = describeResponse(q, resp);
    if (record && !exam) recordAnswer(q, ok, score, mode, hints, summary);
    onResult?.({ ok, score, resp, summary });
  };

  const submit = async () => {
    if (locked || busy) return;
    if (q.type === 'sql') {
      setBusy(true);
      try {
        const r = await checkSql(q, text);
        finish(r.correct, { type: 'sql', query: text }, { sql: r, feedback: r.error ?? r.notes.join(' ') });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (q.type === 'ra') {
      const db = relDb(q.db);
      const exp = runRA(q.solution, db);
      try {
        const node = runRA(text, db);
        const cmp = sameRelation(exp.rel, node.rel);
        finish(cmp.ok, { type: 'ra', expr: text }, { ra: { node, msg: cmp.msg }, feedback: cmp.ok ? undefined : cmp.msg });
      } catch (e) {
        const msg = e instanceof RAError ? e.message : String(e);
        finish(false, { type: 'ra', expr: text }, { ra: { err: msg }, feedback: msg });
      }
      return;
    }
    let resp: Response;
    if (q.type === 'mcq') resp = { type: 'mcq', choice: choice ?? -1 };
    else if (q.type === 'multi') resp = { type: 'multi', choices: multi };
    else if (q.type === 'num') resp = { type: 'num', value: text };
    else if (q.type === 'text') resp = { type: 'text', value: text };
    else if (q.type === 'order') resp = { type: 'order', order };
    else return;
    const r = checkAnswer(q, resp);
    finish(r.correct, resp, { feedback: r.feedback });
  };

  const retry = () => {
    setResult(null);
    if (q.type === 'mcq') setChoice(null);
    if (q.type === 'multi') setMulti([]);
    if (q.type === 'trace') setTraceKey((k) => k + 1);
  };

  const ready =
    q.type === 'mcq' ? choice !== null : q.type === 'multi' ? multi.length > 0 : q.type === 'order' ? true : q.type === 'trace' ? false : text.trim().length > 0;

  const onKey = (e: React.KeyboardEvent) => {
    if (locked) return;
    if ((q.type === 'mcq' || q.type === 'multi') && /^[1-9]$/.test(e.key) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      const i = Number(e.key) - 1;
      if (i < q.options.length) {
        if (q.type === 'mcq') setChoice(i);
        else setMulti((m) => (m.includes(i) ? m.filter((x) => x !== i) : [...m, i]));
      }
    }
  };

  const showFeedback = answered && !exam;
  const followQ = q.follow ? getQuestion(q.follow) : undefined;

  return (
    <div className={`qcard ${compact ? 'compact' : ''} ${showFeedback ? (result!.ok ? 'is-ok' : 'is-bad') : ''}`} ref={cardRef} onKeyDown={onKey}>
      <div className="q-meta">
        <span className="tag">{q.type === 'mcq' ? 'Multiple choice' : q.type === 'multi' ? 'Select all that apply' : q.type === 'num' ? 'Numeric answer' : q.type === 'text' ? 'Short answer' : q.type === 'order' ? 'Put in order' : q.type === 'sql' ? 'Write SQL' : q.type === 'ra' ? 'Write relational algebra' : 'Step-by-step trace'}</span>
        <span className="tag soft">{'●'.repeat(q.level)}{'○'.repeat(3 - q.level)} level {q.level}</span>
        {q.skills.slice(0, 2).map((s) => (
          <span key={s} className="tag soft">
            {SKILL_LABEL[s] ?? s}
          </span>
        ))}
        {q.generated && <span className="tag soft">generated</span>}
      </div>
      <Md md={q.prompt} className="q-prompt" />
      {q.context && <Blocks blocks={q.context} />}

      {q.type === 'mcq' && (
        <div className="opts" role="radiogroup">
          {q.options.map((o, i) => {
            const st = showFeedback && (result!.ok || revealed || single) ? (i === q.answer ? 'right' : i === choice ? 'wrong' : '') : showFeedback && i === choice ? 'wrong' : '';
            return (
              <button key={i} type="button" role="radio" aria-checked={choice === i} className={`opt ${choice === i ? 'on' : ''} ${st}`} disabled={locked} onClick={() => setChoice(i)}>
                <span className="opt-k">{i + 1}</span>
                <Md md={o} />
              </button>
            );
          })}
        </div>
      )}
      {q.type === 'multi' && (
        <div className="opts">
          {q.options.map((o, i) => {
            const on = multi.includes(i);
            const st = showFeedback && (result!.ok || revealed || single) ? (q.answer.includes(i) ? 'right' : on ? 'wrong' : '') : '';
            return (
              <button key={i} type="button" role="checkbox" aria-checked={on} className={`opt ${on ? 'on' : ''} ${st}`} disabled={locked} onClick={() => setMulti(on ? multi.filter((x) => x !== i) : [...multi, i])}>
                <span className="opt-k box">{on ? '✓' : ''}</span>
                <Md md={o} />
              </button>
            );
          })}
        </div>
      )}
      {(q.type === 'num' || q.type === 'text') && (
        <div className="row gap">
          <input
            className="input"
            inputMode={q.type === 'num' ? 'decimal' : 'text'}
            placeholder={q.type === 'num' ? `number${q.unit ? ` (${q.unit})` : ''}` : (q.placeholder ?? 'your answer')}
            value={text}
            disabled={locked}
            aria-label="Your answer"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && submit()}
          />
          {q.type === 'num' && q.unit && <span className="muted">{q.unit}</span>}
        </div>
      )}
      {q.type === 'order' && (
        <ol className="order">
          {order.map((it, i) => (
            <li key={it} className={showFeedback && (result!.ok || revealed || single) ? (q.items[i] === it ? 'right' : 'wrong') : ''}>
              <span className="order-n">{i + 1}</span>
              <span className="order-t">
                <Md md={it} />
              </span>
              <span className="order-btns">
                <button className="icon-btn" aria-label={`Move ${it} up`} disabled={locked || i === 0} onClick={() => setOrder(swap(order, i, i - 1))}>
                  ↑
                </button>
                <button className="icon-btn" aria-label={`Move ${it} down`} disabled={locked || i === order.length - 1} onClick={() => setOrder(swap(order, i, i + 1))}>
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {q.type === 'sql' && <SqlEditor db={q.db} value={text} onChange={setText} disabled={locked} onSubmit={() => ready && submit()} />}
      {q.type === 'ra' && <RaInput db={q.db} value={text} onChange={setText} disabled={locked} onSubmit={() => ready && submit()} />}
      {q.type === 'trace' && (
        <TraceRunner
          key={traceKey}
          spec={q.trace}
          disabled={locked}
          onFinish={(score) => finish(score >= 0.8, { type: 'trace', score }, { feedback: score >= 0.8 ? undefined : `You predicted ${Math.round(score * 100)}% of the steps correctly; 80% is needed.` }, score)}
        />
      )}

      {!answered && q.type !== 'trace' && (
        <div className="row gap q-actions">
          <button className="btn primary" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Running…' : exam ? 'Save answer' : 'Submit'}
          </button>
          {!single && q.hints && hints < q.hints.length && (
            <button className="btn ghost" onClick={() => setHints(hints + 1)}>
              <Icon name="bulb" size={16} /> Hint {hints + 1}/{q.hints.length}
            </button>
          )}
        </div>
      )}
      {!single && hints > 0 && q.hints && (
        <div className="hints">
          {q.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="hint">
              <Icon name="bulb" size={15} />
              <Md md={h} />
            </div>
          ))}
        </div>
      )}
      {exam && answered && <div className="saved">Answer saved — results are shown when you submit the exam.</div>}

      {showFeedback && (
        <div className={`feedback ${result!.ok ? 'ok' : 'bad'}`} aria-live="polite">
          <div className="fb-head">
            <Icon name={result!.ok ? 'check' : 'x'} size={18} />
            <strong>{result!.ok ? 'Correct' : 'Not quite'}</strong>
          </div>
          {!result!.ok && result!.feedback && q.type !== 'sql' && <Md md={result!.feedback} className="fb-why" />}
          {result!.sql && <SqlFeedback r={result!.sql} q={q as Extract<Question, { type: 'sql' }>} revealed={revealed || result!.ok || single} />}
          {result!.ra && q.type === 'ra' && <RaFeedback q={q} info={result!.ra} revealed={revealed || result!.ok || single} />}
          {(result!.ok || revealed || single) && (
            <>
              {!result!.ok && q.type !== 'sql' && q.type !== 'ra' && q.type !== 'trace' && (
                <div className="fb-answer">
                  Correct answer: <Md md={expectedText(q)} />
                </div>
              )}
              <div className="fb-explain">
                <div className="fb-label">Explanation</div>
                <Md md={q.explain} />
                {q.source && <div className="src-line">Source: {q.source}</div>}
              </div>
            </>
          )}
          {!result!.ok && !revealed && !single && <div className="muted small">Think about the feedback, then try again — or reveal the full solution.</div>}
          <div className="row gap wrap">
            {canRetry && (
              <button className="btn primary" onClick={retry}>
                <Icon name="redo" size={16} /> Try again
              </button>
            )}
            {canRetry && (
              <button className="btn ghost" onClick={() => setRevealed(true)}>
                Show solution
              </button>
            )}
            {!result!.ok && followQ && !follow && (
              <button className="btn ghost" onClick={() => setFollow(true)}>
                Try a simpler question
              </button>
            )}
            {onNext && locked && (
              <button className="btn primary" onClick={onNext}>
                {nextLabel ?? 'Next'} <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
        </div>
      )}
      {follow && followQ && (
        <div className="follow">
          <div className="fb-label">Simpler follow-up</div>
          <QuestionCard q={followQ} mode={mode === 'test' || mode === 'exam' ? 'practice' : mode} compact />
        </div>
      )}
    </div>
  );
}

const swap = <T,>(a: T[], i: number, j: number) => {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

/* ---------------- SQL ---------------- */

export function SchemaView({ db }: { db: string }) {
  const d = dataset(db);
  return (
    <details className="schema">
      <summary>
        <Icon name="db" size={15} /> Schema &amp; data: {d.title}
      </summary>
      <div className="schema-tables">
        {d.tables.map((t) => (
          <RelTable key={t.name} compact t={{ title: `${t.name}(${t.cols.map((c) => c.name).join(', ')})`, cols: t.cols.map((c) => c.name), rows: t.rows }} />
        ))}
      </div>
      {d.note && <div className="muted small">{d.note}</div>}
      <div className="muted small">Source: {d.source}</div>
    </details>
  );
}

function SqlEditor({ db, value, onChange, disabled, onSubmit }: { db: string; value: string; onChange: (s: string) => void; disabled?: boolean; onSubmit: () => void }) {
  const [preview, setPreview] = useState<{ r?: QResult; err?: string; notes?: string[] } | null>(null);
  const run = async () => {
    const tr = translateDialect(value);
    if (tr.blocker) return setPreview({ err: tr.blocker });
    const d = await openDataset(db);
    try {
      setPreview({ r: execQuery(d, tr.sql), notes: tr.notes });
    } catch (e) {
      setPreview({ err: (e as Error).message });
    } finally {
      d.close();
    }
  };
  return (
    <div className="sql-editor">
      <SchemaView db={db} />
      <textarea
        className="code-input"
        spellCheck={false}
        rows={Math.max(4, value.split('\n').length + 1)}
        placeholder="SELECT … FROM … WHERE …"
        value={value}
        disabled={disabled}
        aria-label="SQL query"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="row gap">
        <button className="btn ghost" disabled={!value.trim()} onClick={run}>
          <Icon name="play" size={14} /> Run (not graded)
        </button>
        <span className="muted small">Ctrl/⌘ + Enter submits · engine: SQLite (sql.js), running locally</span>
      </div>
      {preview && (
        <div className="preview">
          {preview.err ? <div className="err">{preview.err}</div> : <RelTable compact t={{ title: `Result (${preview.r!.rows.length} rows)`, cols: preview.r!.cols, rows: preview.r!.rows }} />}
          {preview.notes?.map((n, i) => (
            <div key={i} className="muted small">
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SqlFeedback({ r, q, revealed }: { r: SqlCheck; q: Extract<Question, { type: 'sql' }>; revealed: boolean }) {
  return (
    <div className="sql-fb">
      {r.error && <div className="err">Error: {r.error}</div>}
      {r.notes.map((n, i) => (
        <Md key={i} md={n} className="fb-why" />
      ))}
      <div className="cmp-tables">
        {r.got && <RelTable compact t={{ title: 'Your result', cols: r.got.cols, rows: r.got.rows }} />}
        {r.expectedResult && <RelTable compact t={{ title: 'Expected result', cols: r.expectedResult.cols, rows: r.expectedResult.rows }} />}
      </div>
      {revealed && (
        <>
          <Code code={q.solution} title="A correct query" />
          <PipelineView db={q.db} sql={q.solution} title="How the solution is evaluated, clause by clause" />
        </>
      )}
    </div>
  );
}

export function PipelineView({ db, sql, title }: { db: string; sql: string; title?: string }) {
  const steps = useMemo(() => pipeline(sql), [sql]);
  const [res, setRes] = useState<(QResult | string)[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !steps) return;
    let alive = true;
    (async () => {
      const d = await openDataset(db);
      const out = steps.map((s) => {
        try {
          return execQuery(d, s.sql);
        } catch (e) {
          return (e as Error).message;
        }
      });
      d.close();
      if (alive) setRes(out);
    })();
    return () => {
      alive = false;
    };
  }, [open, steps, db]);
  if (!steps) return null;
  return (
    <details className="pipeline" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{title ?? 'Show the logical evaluation order'}</summary>
      <ol className="pipe-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <div className="pipe-h">
              <span className="tag">{i + 1}</span> <strong>{s.label}</strong>
            </div>
            <div className="muted small">{s.detail}</div>
            {res && (typeof res[i] === 'string' ? <div className="err small">{res[i] as string}</div> : <RelTable compact t={{ cols: (res[i] as QResult).cols, rows: (res[i] as QResult).rows }} />)}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ---------------- Relational algebra ---------------- */

const RA_SYMS = ['σ', 'π', 'ρ', '⋈', '×', '∪', '∩', '−', '∧', '∨', '¬', '≠', '≤', '≥', '[', ']', '(', ')'];

export function RaInput({ db, value, onChange, disabled, onSubmit }: { db: string; value: string; onChange: (s: string) => void; disabled?: boolean; onSubmit?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ node?: RANode; err?: string } | null>(null);
  const ins = (s: string) => {
    const el = ref.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    const next = value.slice(0, a) + s + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };
  const d = dataset(db);
  return (
    <div className="ra-input">
      <div className="schema-tables">
        {d.tables.map((t) => (
          <RelTable key={t.name} compact t={{ title: `${t.name}(${t.cols.map((c) => c.name).join(', ')})`, cols: t.cols.map((c) => c.name), rows: t.rows }} />
        ))}
      </div>
      <div className="sym-row" aria-label="Insert operator">
        {RA_SYMS.map((s) => (
          <button key={s} type="button" className="chip sym" disabled={disabled} onClick={() => ins(s)}>
            {s}
          </button>
        ))}
      </div>
      <input
        ref={ref}
        className="input code-font"
        value={value}
        disabled={disabled}
        placeholder="e.g.  π[a_id](σ[b_id > 102](R))"
        aria-label="Relational algebra expression"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
      />
      <div className="row gap">
        <button
          className="btn ghost"
          disabled={!value.trim()}
          onClick={() => {
            try {
              setPreview({ node: runRA(value, relDb(db)) });
            } catch (e) {
              setPreview({ err: (e as Error).message });
            }
          }}
        >
          <Icon name="play" size={14} /> Evaluate (not graded)
        </button>
        <span className="muted small">ASCII also works: select[…](R), project[…](R), R join S, R union S, R minus S, R cross S, and/or/not</span>
      </div>
      {preview && (preview.err ? <div className="err">{preview.err}</div> : <RelTable compact t={{ title: `Result (${preview.node!.rel.rows.length} tuples)`, cols: colLabels(preview.node!.rel), rows: preview.node!.rel.rows }} />)}
    </div>
  );
}

export function RaSteps({ node, interactive = true }: { node: RANode; interactive?: boolean }) {
  const steps = raSteps(node);
  const [shown, setShown] = useState(interactive ? 1 : steps.length);
  return (
    <div className="ra-steps">
      {steps.slice(0, shown).map((s, i) => (
        <div key={i} className="ra-step">
          <div className="pipe-h">
            <span className="tag">{i + 1}</span> <code>{s.label}</code>
          </div>
          <div className="muted small">{s.explain}</div>
          <RelTable compact t={{ cols: colLabels(s.rel), rows: s.rel.rows }} />
        </div>
      ))}
      {shown < steps.length && (
        <button className="btn ghost" onClick={() => setShown(shown + 1)}>
          Reveal next intermediate result ({shown}/{steps.length})
        </button>
      )}
    </div>
  );
}

function RaFeedback({ q, info, revealed }: { q: Extract<Question, { type: 'ra' }>; info: { node?: RANode; err?: string; msg?: string }; revealed: boolean }) {
  const sol = useMemo(() => runRA(q.solution, relDb(q.db)), [q]);
  return (
    <div className="sql-fb">
      {info.err && <div className="err">{info.err}</div>}
      <div className="cmp-tables">
        {info.node && <RelTable compact t={{ title: 'Your result', cols: colLabels(info.node.rel), rows: info.node.rel.rows }} />}
        <RelTable compact t={{ title: 'Expected result', cols: colLabels(sol.rel), rows: sol.rel.rows }} />
      </div>
      {revealed && (
        <>
          <div className="fb-answer">
            One correct expression: <code>{q.solution}</code>
          </div>
          <RaSteps node={sol} interactive={false} />
        </>
      )}
    </div>
  );
}

/** Read-only review of an answered question (exam review / mistakes log). */
export function AnswerReview({ q, summary, ok }: { q: Question; summary: string; ok: boolean }) {
  return (
    <div className={`qcard review ${ok ? 'is-ok' : 'is-bad'}`}>
      <div className="q-meta">
        <span className={`tag ${ok ? 'good' : 'bad'}`}>{ok ? 'Correct' : 'Incorrect'}</span>
        {q.skills.slice(0, 2).map((s) => (
          <span key={s} className="tag soft">
            {SKILL_LABEL[s] ?? s}
          </span>
        ))}
      </div>
      <Md md={q.prompt} className="q-prompt" />
      {q.context && <Blocks blocks={q.context} />}
      <div className="fb-answer">
        Your answer: <span className="mono">{summary || '(no answer)'}</span>
      </div>
      {q.type !== 'trace' && (
        <div className="fb-answer">
          Correct answer: {q.type === 'sql' ? <Code code={q.solution} /> : <Md md={expectedText(q)} />}
        </div>
      )}
      <div className="fb-explain">
        <div className="fb-label">Explanation</div>
        <Md md={q.explain} />
        {q.source && <div className="src-line">Source: {q.source}</div>}
      </div>
    </div>
  );
}
