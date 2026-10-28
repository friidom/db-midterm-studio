import { useEffect, useMemo, useState } from 'react';
import { MODULES, moduleById, SKILL_LABEL, SKILL_MODULE } from '../content/modules';
import { QUESTIONS, getQuestion } from '../content';
import { useProgress, update, activity, recordAnswer, getState } from '../store';
import { gradeTest, recordTest, recordExam, seenCounts, skillStat, isUnlocked, type ProgressState } from '../lib/progress';
import { assembleExam, assembleTest, scoreExam, weakAreas } from '../lib/exam';
import { generate, gensForModule, type GenKind } from '../lib/generators';
import { newSeed, rng, pick } from '../lib/random';
import type { Question } from '../lib/types';
import { AnswerReview, QuestionCard, type QResultInfo } from './Question';
import { Bar, Empty, Icon, StatusPill, pct, ago } from './kit';
import { Locked, statusOf } from './pages';

const usable = (q: Question, u: 'practice' | 'test' | 'exam') => (q.use ?? ['practice', 'test', 'exam']).includes(u);

/** Adaptive pick: review queue → weak skills → unseen → least recent; ~30% generated traces when available. */
function pickPractice(s: ProgressState, mods: string[], skill: string | undefined, recent: string[], seed: number): Question | undefined {
  const r = rng(seed);
  const pool = QUESTIONS.filter((q) => mods.includes(q.module) && usable(q, 'practice') && (!skill || q.skills.includes(skill)));
  const gens = mods.flatMap((m) => gensForModule(m)).filter((g) => !skill || generate(g, 1).skills.includes(skill));
  const inQueue = Object.keys(s.review).filter((id) => mods.includes(getQuestion(id)?.module ?? '') && !recent.includes(id));
  if (inQueue.length && r() < 0.5) return getQuestion(pick(r, inQueue));
  if (gens.length && (r() < 0.3 || !pool.length)) return generate(pick(r, gens) as GenKind, newSeed());
  const lastSeen: Record<string, number> = {};
  s.attempts.forEach((a, i) => (lastSeen[a.q] = i));
  const scored = pool
    .filter((q) => !recent.includes(q.id))
    .map((q) => {
      let sc = r() * 0.5;
      if (s.review[q.id]) sc += 3;
      if (q.skills.some((k) => skillStat(s.attempts, k).score < 0.6 && skillStat(s.attempts, k).n >= 2)) sc += 2;
      if (lastSeen[q.id] === undefined) sc += 1.5;
      else sc -= (lastSeen[q.id] - s.attempts.length + 40) / 40;
      return { q, sc };
    })
    .sort((a, b) => b.sc - a.sc);
  return scored[0]?.q ?? pool[0];
}

/* ---------------- Practice ---------------- */
export function Practice({ module, skill }: { module?: string; skill?: string }) {
  const s = useProgress();
  const unlocked = MODULES.filter((m) => isUnlocked(s, m));
  const m = module ? moduleById(module) : undefined;
  const [seed, setSeed] = useState(newSeed());
  const [recent, setRecent] = useState<string[]>([]);
  const [stats, setStats] = useState({ n: 0, ok: 0 });
  const mods = m ? [m.id] : unlocked.map((x) => x.id);
  const q = useMemo(() => pickPractice(getState(), mods, skill, recent, seed), [seed, module, skill]); // eslint-disable-line react-hooks/exhaustive-deps
  if (m && !isUnlocked(s, m)) return <Locked m={m} />;
  const next = () => {
    if (q) setRecent([q.id, ...recent].slice(0, 12));
    setSeed(newSeed());
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Practice{m ? ` · ${m.title}` : ' · all modules'}</div>
          <h1>{skill ? `Targeted practice: ${SKILL_LABEL[skill]}` : 'Adaptive practice'}</h1>
          <p className="muted">One question at a time. Questions you missed, weak skills and new questions come first. Hints and retries are allowed here; using them lowers the credit towards mastery.</p>
        </div>
        <div className="session">
          <div className="big-num">
            {stats.ok}/{stats.n}
          </div>
          <div className="small muted">this session</div>
        </div>
      </header>
      <div className="row gap wrap filter-row">
        <a className={`chip ${!m ? 'on' : ''}`} href="#/practice">
          All modules
        </a>
        {MODULES.map((x) => (
          <a key={x.id} className={`chip ${m?.id === x.id ? 'on' : ''} ${isUnlocked(s, x) ? '' : 'disabled'}`} href={isUnlocked(s, x) ? `#/practice/${x.id}` : undefined} aria-disabled={!isUnlocked(s, x)}>
            {!isUnlocked(s, x) && <Icon name="lock" size={11} />} {x.short}
          </a>
        ))}
      </div>
      {q ? (
        <QuestionCard
          key={q.id + seed}
          q={q}
          mode="practice"
          onResult={(r) => {
            setStats((st) => ({ n: st.n + 1, ok: st.ok + (r.ok ? 1 : 0) }));
            if (stats.n === 0) activity({ kind: 'practice', label: `Practised ${m ? m.short : 'all modules'}`, link: `#/practice${m ? '/' + m.id : ''}` });
          }}
          onNext={next}
          nextLabel="Next question"
        />
      ) : (
        <Empty title="No questions available">Unlock a module first.</Empty>
      )}
      <div className="row gap">
        <button className="btn link" onClick={next}>
          Skip this question
        </button>
      </div>
    </div>
  );
}

/* ---------------- Module test ---------------- */
export function ModuleTest({ id }: { id: string }) {
  const s = useProgress();
  const m = moduleById(id);
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro');
  const [ids, setIds] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [res, setRes] = useState<Record<string, QResultInfo>>({});
  useEffect(() => setPhase('intro'), [id]);
  if (!m) return <Empty title="Module not found" />;
  if (!isUnlocked(s, m)) return <Locked m={m} />;
  const qs = ids.map((x) => getQuestion(x)!).filter(Boolean);
  const start = () => {
    const pool = QUESTIONS.filter((q) => q.module === m.id);
    setIds(assembleTest(pool, m, seenCounts(getState()), newSeed()));
    setRes({});
    setI(0);
    setPhase('run');
  };
  const finish = () => {
    const g = gradeTest(
      m,
      qs.map((q) => ({ ok: !!res[q.id]?.ok, skills: q.skills })),
    );
    update((st) => recordTest(st, { module: m.id, t: Date.now(), correct: g.correct, total: g.total, passed: g.passed, skills: g.skills, unmet: g.unmet }));
    activity({ kind: 'test', label: `${m.short} test: ${g.correct}/${g.total}${g.passed ? ' — passed' : ''}`, link: `#/module/${m.id}` });
    setPhase('done');
  };
  if (phase === 'intro')
    return (
      <div className="page narrow">
        <header className="page-head">
          <div>
            <div className="eyebrow">Module test · {m.title}</div>
            <h1>Show what you can do on your own</h1>
          </div>
          <StatusPill status={statusOf(s, m)} />
        </header>
        <section className="card">
          <ul>
            <li>
              <strong>{m.test.size} questions</strong> drawn across every skill of the module, favouring questions you have seen least.
            </li>
            <li>No hints, one attempt per question. Feedback and the explanation appear after each answer.</li>
            <li>
              Pass mark: <strong>{pct(m.test.pass)}</strong>
              {m.test.require?.map((r) => (
                <span key={r.skill}>
                  , plus at least {r.min} correct on <strong>{r.label}</strong>
                </span>
              ))}
              .
            </li>
            <li>Passing marks the module as mastered.</li>
          </ul>
          <button className="btn primary lg" onClick={start}>
            Start the test
          </button>
        </section>
      </div>
    );
  if (phase === 'run') {
    const q = qs[i];
    const answered = !!res[q.id];
    return (
      <div className="page narrow">
        <header className="page-head">
          <div>
            <div className="eyebrow">
              {m.short} test · question {i + 1} of {qs.length}
            </div>
            <Bar value={(i + (answered ? 1 : 0)) / qs.length} />
          </div>
        </header>
        <QuestionCard
          key={q.id}
          q={q}
          mode="test"
          onResult={(r) => setRes((x) => ({ ...x, [q.id]: r }))}
          onNext={() => (i + 1 < qs.length ? setI(i + 1) : finish())}
          nextLabel={i + 1 < qs.length ? 'Next question' : 'See results'}
        />
      </div>
    );
  }
  const g = gradeTest(
    m,
    qs.map((q) => ({ ok: !!res[q.id]?.ok, skills: q.skills })),
  );
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <div className="eyebrow">{m.short} test result</div>
          <h1>
            {g.correct} / {g.total} — {g.passed ? 'Passed 🎉' : 'Not passed yet'}
          </h1>
          <p className="muted">{g.passed ? `${m.short} is mastered.` : 'Review the skills below, practise, then retake the test (you get a new set of questions).'}</p>
        </div>
      </header>
      {!g.passed && (
        <div className="callout warn">
          <Icon name="warn" size={18} />
          <div>
            <div className="callout-title">Mastery criteria not met</div>
            {g.unmet.join(' · ')}
          </div>
        </div>
      )}
      <section className="card">
        <h3>By skill</h3>
        {Object.entries(g.skills).map(([k, [c, t]]) => (
          <div key={k} className="skill-line">
            <span className="grow">{SKILL_LABEL[k] ?? k}</span>
            <span className="small">
              {c}/{t}
            </span>
            <span className="bar-cell">
              <Bar value={c / t} tone={c / t >= 0.8 ? 'good' : c / t >= 0.5 ? 'warn' : 'bad'} />
            </span>
            {c / t < 0.8 && (
              <a className="btn link sm" href={`#/practice/${m.id}?skill=${k}`}>
                Practise
              </a>
            )}
          </div>
        ))}
      </section>
      <div className="row gap">
        <button className="btn primary" onClick={start}>
          {g.passed ? 'Retake with new questions' : 'Retake the test'}
        </button>
        <a className="btn ghost" href={`#/practice/${m.id}`}>
          Practise {m.short}
        </a>
        <a className="btn ghost" href="#/">
          Dashboard
        </a>
      </div>
      <h3>Review your answers</h3>
      {qs.map((q) => (
        <AnswerReview key={q.id} q={q} ok={!!res[q.id]?.ok} summary={res[q.id]?.summary ?? ''} />
      ))}
    </div>
  );
}

/* ---------------- Exam mode ---------------- */
const FORMATS = {
  full: { label: 'Full practice midterm', size: 24, minutes: 60, gens: 3 },
  quick: { label: 'Quick quiz', size: 10, minutes: 20, gens: 1 },
} as const;

export function Exam() {
  const s = useProgress();
  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup');
  const [format, setFormat] = useState<'full' | 'quick' | 'custom'>('full');
  const [customMods, setCustomMods] = useState<string[]>(MODULES.map((m) => m.id));
  const [customSize, setCustomSize] = useState(15);
  const [timed, setTimed] = useState(true);
  const [qs, setQs] = useState<Question[]>([]);
  const [i, setI] = useState(0);
  const [res, setRes] = useState<Record<string, QResultInfo>>({});
  const [ver, setVer] = useState<Record<string, number>>({});
  const [startT, setStartT] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [onlyWrong, setOnlyWrong] = useState(true);
  const minutes = format === 'custom' ? Math.round(customSize * 2.5) : FORMATS[format].minutes;
  useEffect(() => {
    if (phase !== 'run' || !timed) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [phase, timed]);
  const left = Math.max(0, startT + minutes * 60000 - now);
  const submit = () => {
    const ok = Object.fromEntries(qs.map((q) => [q.id, !!res[q.id]?.ok]));
    const sc = scoreExam(qs, ok);
    for (const q of qs) recordAnswer(q, !!res[q.id]?.ok, res[q.id]?.score ?? 0, 'exam', 0, res[q.id]?.summary ?? '(no answer)');
    const label = format === 'custom' ? 'Custom exam' : FORMATS[format].label;
    update((st) => recordExam(st, { id: `e${Date.now()}`, t: Date.now(), format: label, correct: sc.correct, total: sc.total, secs: Math.round((Date.now() - startT) / 1000), byModule: sc.byModule, qids: qs.map((q) => q.id), wrong: sc.wrong }));
    activity({ kind: 'exam', label: `${label}: ${sc.correct}/${sc.total}`, link: '#/exam' });
    setPhase('done');
  };
  useEffect(() => {
    if (phase === 'run' && timed && left === 0) submit();
  }, [left, phase, timed]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    const mods = format === 'custom' ? customMods : MODULES.map((m) => m.id);
    const size = format === 'custom' ? customSize : FORMATS[format].size;
    const weights = Object.fromEntries(MODULES.filter((m) => mods.includes(m.id)).map((m) => [m.id, m.examWeight]));
    const seed = newSeed();
    const pool = QUESTIONS.filter((q) => q.type !== 'trace' && usable(q, 'exam'));
    const nGen = format === 'custom' ? Math.min(2, Math.floor(size / 6)) : FORMATS[format].gens;
    const ids = assembleExam(pool, { size: size - nGen, weights, seen: seenCounts(getState()), seed });
    const r = rng(seed);
    const genKinds: GenKind[] = (['buf-evict', 'buf-misses', 'bptree-root', 'rle', 'ra-count'] as GenKind[]).filter((g) => mods.includes(generate(g, 1).module));
    const gens = Array.from({ length: genKinds.length ? nGen : 0 }, (_, k) => generate(pick(r, genKinds), seed + k + 1));
    setQs([...ids.map((x) => getQuestion(x)!), ...gens]);
    setRes({});
    setVer({});
    setI(0);
    setStartT(Date.now());
    setNow(Date.now());
    setPhase('run');
  };

  if (phase === 'setup')
    return (
      <div className="page narrow">
        <header className="page-head">
          <div>
            <div className="eyebrow">Exam mode</div>
            <h1>Practice midterm</h1>
            <p className="muted">
              <strong>Unofficial practice format.</strong> No sample exam was provided, so the real format is unknown. Questions mix multiple choice, short answer, SQL, relational algebra, layout scenarios and trace results. They are weighted by the syllabus Weeks 1–6, randomized, and favour questions you have not seen. Answers are revealed only after you submit.
            </p>
          </div>
        </header>
        <section className="card">
          <div className="seg wrap" role="radiogroup" aria-label="Format">
            {(['full', 'quick', 'custom'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} className={`seg-b ${format === f ? 'on' : ''}`} onClick={() => setFormat(f)}>
                {f === 'custom' ? 'Custom' : `${FORMATS[f].label} · ${FORMATS[f].size} Q · ${FORMATS[f].minutes} min`}
              </button>
            ))}
          </div>
          {format === 'custom' && (
            <div className="custom-exam">
              <div className="row gap wrap">
                {MODULES.map((m) => (
                  <label key={m.id} className="chk">
                    <input type="checkbox" checked={customMods.includes(m.id)} onChange={(e) => setCustomMods(e.target.checked ? [...customMods, m.id] : customMods.filter((x) => x !== m.id))} /> {m.short}
                  </label>
                ))}
              </div>
              <label className="small">
                Questions{' '}
                <input className="input xs" type="number" min={5} max={40} value={customSize} onChange={(e) => setCustomSize(Math.max(5, Math.min(40, Number(e.target.value) || 5)))} />
              </label>
            </div>
          )}
          <label className="chk">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Timed ({minutes} min; auto-submits at 0)
          </label>
          <div>
            <button className="btn primary lg" disabled={format === 'custom' && customMods.length === 0} onClick={start}>
              Start exam
            </button>
          </div>
        </section>
        {s.exams.length > 0 && (
          <section className="card">
            <h3>Previous attempts</h3>
            <table className="mini wide">
              <tbody>
                {[...s.exams].reverse().slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td>{e.format}</td>
                    <td>
                      {e.correct}/{e.total} ({pct(e.correct / e.total)})
                    </td>
                    <td className="muted small">{ago(e.t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    );

  if (phase === 'run') {
    const q = qs[i];
    const answeredN = qs.filter((x) => res[x.id]).length;
    return (
      <div className="page narrow">
        <header className="page-head exam-bar">
          <div className="grow">
            <div className="eyebrow">
              Question {i + 1} of {qs.length} · {answeredN} answered
            </div>
            <div className="qnav" aria-label="Question navigator">
              {qs.map((x, k) => (
                <button key={x.id} className={`qdot ${k === i ? 'cur' : ''} ${res[x.id] ? 'done' : ''}`} onClick={() => setI(k)} aria-label={`Question ${k + 1}${res[x.id] ? ' (answered)' : ''}`}>
                  {k + 1}
                </button>
              ))}
            </div>
          </div>
          {timed && (
            <div className={`timer ${left < 5 * 60000 ? 'low' : ''}`} aria-live="off">
              <Icon name="clock" size={16} /> {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}
            </div>
          )}
        </header>
        <QuestionCard key={`${q.id}-${ver[q.id] ?? 0}`} q={q} mode="exam" exam record={false} onResult={(r) => setRes((x) => ({ ...x, [q.id]: r }))} />
        {res[q.id] && (
          <button
            className="btn link"
            onClick={() => {
              const { [q.id]: _drop, ...rest } = res;
              void _drop;
              setRes(rest);
              setVer({ ...ver, [q.id]: (ver[q.id] ?? 0) + 1 });
            }}
          >
            Change this answer
          </button>
        )}
        <div className="row gap wrap exam-nav">
          <button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            <Icon name="back" size={16} /> Previous
          </button>
          <button className="btn ghost" disabled={i === qs.length - 1} onClick={() => setI(i + 1)}>
            Next <Icon name="chevron" size={16} />
          </button>
          <span className="grow" />
          <button
            className="btn primary"
            onClick={() => {
              if (answeredN < qs.length && !confirm(`${qs.length - answeredN} question(s) are unanswered and will be marked wrong. Submit anyway?`)) return;
              submit();
            }}
          >
            Submit exam
          </button>
        </div>
      </div>
    );
  }

  const ok = Object.fromEntries(qs.map((q) => [q.id, !!res[q.id]?.ok]));
  const sc = scoreExam(qs, ok);
  const weakMods = weakAreas(sc.byModule);
  const weakSk = weakAreas(sc.bySkill).filter((w) => sc.bySkill[w.id][1] >= 2);
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <div className="eyebrow">Practice exam result (unofficial format)</div>
          <h1>
            {sc.correct} / {sc.total} · {pct(sc.correct / sc.total)}
          </h1>
          <p className="muted">Time used: {Math.round((Date.now() - startT) / 60000)} min. Every wrong answer has been added to your review queue.</p>
        </div>
      </header>
      <section className="card">
        <h3>Score by topic</h3>
        {Object.entries(sc.byModule).map(([mid, [c, t]]) => (
          <div key={mid} className="skill-line">
            <span className="grow">{moduleById(mid)?.title}</span>
            <span className="small">
              {c}/{t}
            </span>
            <span className="bar-cell">
              <Bar value={c / t} tone={c / t >= 0.8 ? 'good' : c / t >= 0.5 ? 'warn' : 'bad'} />
            </span>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>Recommended next steps</h3>
        {weakMods.length === 0 && weakSk.length === 0 ? (
          <p>Strong across the board. Try a timed full exam, or clear your review queue.</p>
        ) : (
          <ul>
            {weakMods.map((w) => (
              <li key={w.id}>
                <strong>{moduleById(w.id)?.short}</strong> ({pct(w.pct)}) — <a href={`#/practice/${w.id}`}>targeted practice</a> · <a href={`#/module/${w.id}`}>revisit the lessons</a>
              </li>
            ))}
            {weakSk.slice(0, 5).map((w) => (
              <li key={w.id}>
                Skill <strong>{SKILL_LABEL[w.id] ?? w.id}</strong> ({pct(w.pct)}) — <a href={`#/practice/${SKILL_MODULE[w.id]}?skill=${w.id}`}>practise this skill</a>
              </li>
            ))}
          </ul>
        )}
        <div className="row gap">
          <button className="btn primary" onClick={() => setPhase('setup')}>
            New exam
          </button>
          <a className="btn ghost" href="#/review">
            Review queue
          </a>
        </div>
      </section>
      <div className="row gap">
        <h3 className="grow">Review answers</h3>
        <label className="chk">
          <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> Incorrect only
        </label>
      </div>
      {qs
        .filter((q) => !onlyWrong || !ok[q.id])
        .map((q) => (
          <AnswerReview key={q.id} q={q} ok={ok[q.id]} summary={res[q.id]?.summary ?? ''} />
        ))}
    </div>
  );
}

/* ---------------- Mistakes & review ---------------- */
export function Review() {
  const s = useProgress();
  const items = Object.values(s.review)
    .map((r) => ({ r, q: getQuestion(r.q) }))
    .filter((x): x is { r: (typeof x)['r']; q: Question } => !!x.q)
    .sort((a, b) => b.r.misses - a.r.misses || b.r.last - a.r.last);
  const [session, setSession] = useState<string[] | null>(null);
  const [k, setK] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const log = [...s.attempts]
    .reverse()
    .filter((a) => !a.ok)
    .slice(0, 20);
  if (session) {
    const q = getQuestion(session[k]);
    if (!q || k >= session.length)
      return (
        <div className="page narrow">
          <h1>Review session finished</h1>
          <p className="muted">{Object.keys(s.review).length} question(s) remain in your queue.</p>
          <button className="btn primary" onClick={() => setSession(null)}>
            Back to the review queue
          </button>
        </div>
      );
    return (
      <div className="page narrow">
        <header className="page-head">
          <div>
            <div className="eyebrow">
              Review session · {k + 1} of {session.length}
            </div>
            <Bar value={k / session.length} />
          </div>
          <button className="btn ghost sm" onClick={() => setSession(null)}>
            End session
          </button>
        </header>
        <QuestionCard key={q.id + k} q={q} mode="review" onNext={() => setK(k + 1)} nextLabel={k + 1 < session.length ? 'Next' : 'Finish'} />
      </div>
    );
  }
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Mistakes &amp; review</div>
          <h1>Close the loop on what you missed</h1>
          <p className="muted">Every wrong answer lands here (lessons, practice, tests and exams). A question leaves the queue after you answer it correctly twice in a row.</p>
        </div>
        {items.length > 0 && (
          <button
            className="btn primary"
            onClick={() => {
              setSession(items.map((x) => x.q.id));
              setK(0);
              activity({ kind: 'review', label: `Review session (${items.length} questions)`, link: '#/review' });
            }}
          >
            Start review session ({items.length})
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <Empty title="Your review queue is empty">Questions you answer incorrectly will appear here.</Empty>
      ) : (
        <section className="card">
          <h3>Review queue</h3>
          <ul className="plain review-list">
            {items.map(({ r, q }) => (
              <li key={q.id}>
                <div className="row gap">
                  <span className="grow">
                    <span className="tag soft">{moduleById(q.module)?.short}</span> {q.prompt.replace(/[*`#]/g, '').slice(0, 110)}
                    {q.prompt.length > 110 ? '…' : ''}
                  </span>
                  <span className="small muted">
                    missed {r.misses}× · streak {r.streak}/2
                  </span>
                  <button className="btn ghost sm" onClick={() => setOpen(open === q.id ? null : q.id)}>
                    {open === q.id ? 'Close' : 'Retry'}
                  </button>
                </div>
                {r.resp && <div className="small muted">Your last wrong answer: {r.resp.slice(0, 120)}</div>}
                {open === q.id && <QuestionCard key={q.id + r.misses + r.streak} q={q} mode="review" compact />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <h3>Recent mistakes log</h3>
        {log.length === 0 ? (
          <Empty title="No mistakes recorded yet" />
        ) : (
          <table className="mini wide">
            <thead>
              <tr>
                <th>Question</th>
                <th>Your answer</th>
                <th>Where</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {log.map((a, i) => {
                const q = getQuestion(a.q);
                return (
                  <tr key={i}>
                    <td>{q ? q.prompt.replace(/[*`#]/g, '').slice(0, 70) + (q.prompt.length > 70 ? '…' : '') : a.q}</td>
                    <td className="mono small">{(a.resp ?? '').slice(0, 50)}</td>
                    <td className="small">{a.mode}</td>
                    <td className="small muted">{ago(a.t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
