import { useEffect, useState } from 'react';
import { MODULES, moduleById, SKILL_LABEL } from '../content/modules';
import { LESSONS, lessonsOf, lessonById, lessonChecks, QUESTIONS } from '../content';
import { useProgress, update, resetProgress, activity, storageOk } from '../store';
import {
  moduleStatus,
  lessonCompletion,
  moduleMastery,
  nextAction,
  skillStat,
  checksPassed,
  completeLesson,
  openLesson,
  isUnlocked,
  weakSkills,
  lastTest,
  type ProgressState,
} from '../lib/progress';
import type { ModuleDef, WidgetName } from '../lib/types';
import { Bar, Icon, LevelPill, Md, Ring, StatusPill, Empty, pct, ago } from './kit';
import { Blocks } from './Blocks';
import { Widget } from './widgets';

export const lessonIds = (m: string) => lessonsOf(m).map((l) => l.id);
export const statusOf = (s: ProgressState, m: ModuleDef) => moduleStatus(s, m, lessonIds(m.id));

export function Locked({ m }: { m: ModuleDef }) {
  return (
    <div className="card lock-card">
      <Icon name="lock" size={28} />
      <h2>{m.short} is locked</h2>
      <p>
        Master the prerequisite module{m.prereqs.length > 1 ? 's' : ''} first:{' '}
        {m.prereqs.map((p, i) => (
          <span key={p}>
            {i > 0 && ', '}
            <a href={`#/module/${p}`}>{moduleById(p)?.title}</a>
          </span>
        ))}
        . A module is mastered by passing its module test — reading lessons alone does not unlock anything.
      </p>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
export function Dashboard() {
  const s = useProgress();
  const na = nextAction(s, MODULES, lessonsOf, (k) => SKILL_LABEL[k] ?? k);
  const totalLessons = LESSONS.length;
  const doneLessons = LESSONS.filter((l) => s.lessons[l.id]?.done).length;
  const mastered = MODULES.filter((m) => statusOf(s, m) === 'mastered' || s.passed[m.id]).length;
  const queue = Object.keys(s.review).length;
  const weak = MODULES.flatMap((m) => weakSkills(s, m.skills.map((k) => k.id)).map((k) => ({ k, m })));
  const answered = s.attempts.length;
  const acc = answered ? s.attempts.filter((a) => a.ok).length / answered : 0;
  const recentTests = [...s.tests].reverse().slice(0, 4);
  const recentExams = [...s.exams].reverse().slice(0, 3);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">SOC3020 Databases · Midterm (Week 7, covers Weeks 1–6)</div>
          <h1>Your study dashboard</h1>
        </div>
      </header>
      <section className="card next-card">
        <div className="next-icon">
          <Icon name="target" size={26} />
        </div>
        <div className="grow">
          <div className="eyebrow">Next recommended action</div>
          <h2>{na.title}</h2>
          <p className="muted">{na.detail}</p>
        </div>
        <a className="btn primary lg" href={na.link}>
          {na.cta} <Icon name="chevron" size={16} />
        </a>
      </section>
      <section className="stats-row">
        <div className="card stat">
          <Ring value={doneLessons / totalLessons} label="Lessons completed" />
          <div>
            <div className="stat-k">Lessons completed</div>
            <div className="stat-v">
              {doneLessons} / {totalLessons}
            </div>
            <div className="muted small">Completion = reading + passing the quick checks</div>
          </div>
        </div>
        <div className="card stat">
          <Ring value={mastered / MODULES.length} label="Modules mastered" />
          <div>
            <div className="stat-k">Modules mastered</div>
            <div className="stat-v">
              {mastered} / {MODULES.length}
            </div>
            <div className="muted small">Mastery = passing the module test</div>
          </div>
        </div>
        <div className="card stat">
          <div className="big-num">{pct(acc)}</div>
          <div>
            <div className="stat-k">Answer accuracy</div>
            <div className="stat-v">{answered} answered</div>
            <div className="muted small">All modes, first and later attempts</div>
          </div>
        </div>
        <a className="card stat link-card" href="#/review">
          <div className="big-num">{queue}</div>
          <div>
            <div className="stat-k">Review queue</div>
            <div className="stat-v">{queue ? 'questions to revisit' : 'all clear'}</div>
            <div className="muted small">Wrong answers wait here until you get them right twice</div>
          </div>
        </a>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <h3>Modules</h3>
            <a href="#/roadmap" className="small">
              Roadmap →
            </a>
          </div>
          <div className="mod-list">
            {MODULES.map((m) => {
              const st = statusOf(s, m);
              return (
                <a key={m.id} className={`mod-row ${st}`} href={st === 'locked' ? '#/roadmap' : `#/module/${m.id}`}>
                  <span className="mod-num">{m.num}</span>
                  <span className="grow">
                    <span className="mod-title">{m.title}</span>
                    <span className="mod-bars">
                      <span className="small muted">lessons</span>
                      <Bar value={lessonCompletion(s, lessonIds(m.id))} label={`${m.short} lessons`} />
                      <span className="small muted">mastery</span>
                      <Bar value={moduleMastery(s, m)} tone="good" label={`${m.short} mastery`} />
                    </span>
                  </span>
                  <StatusPill status={st} />
                </a>
              );
            })}
          </div>
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-h">
              <h3>Weak topics</h3>
            </div>
            {weak.length === 0 ? (
              <Empty title="No weak skills detected">They appear when your recent answers on a skill drop below 60%.</Empty>
            ) : (
              <ul className="plain">
                {weak.slice(0, 6).map(({ k, m }) => {
                  const lid = m.skills.find((x) => x.id === k)?.lesson;
                  return (
                    <li key={k} className="weak-row">
                      <span>
                        <strong>{SKILL_LABEL[k]}</strong> <span className="muted small">· {m.short}</span>
                      </span>
                      <span className="row gap">
                        {lid && (
                          <a className="btn link sm" href={`#/lesson/${lid}`}>
                            Review lesson
                          </a>
                        )}
                        <a className="btn ghost sm" href={`#/practice/${m.id}?skill=${k}`}>
                          Practise
                        </a>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="card">
            <div className="card-h">
              <h3>Recent scores</h3>
              <a href="#/progress" className="small">
                All stats →
              </a>
            </div>
            {recentTests.length + recentExams.length === 0 ? (
              <Empty title="No tests or exams yet">Module tests and practice exams will show up here.</Empty>
            ) : (
              <ul className="plain">
                {recentExams.map((e) => (
                  <li key={e.id} className="score-row">
                    <span>
                      Practice exam <span className="muted small">· {ago(e.t)}</span>
                    </span>
                    <strong>
                      {e.correct}/{e.total}
                    </strong>
                  </li>
                ))}
                {recentTests.map((t, i) => (
                  <li key={i} className="score-row">
                    <span>
                      {moduleById(t.module)?.short} test <span className="muted small">· {ago(t.t)}</span>
                    </span>
                    <span className={`pill ${t.passed ? 'st-mastered' : 'st-needs-review'}`}>
                      {t.correct}/{t.total} {t.passed ? 'passed' : 'not passed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <div className="card-h">
              <h3>Recent activity</h3>
            </div>
            {s.activity.length === 0 ? (
              <Empty title="Nothing yet">Start with the first lesson — your activity will appear here.</Empty>
            ) : (
              <ul className="plain activity">
                {s.activity.slice(0, 7).map((a, i) => (
                  <li key={i}>
                    <a href={a.link ?? '#/'}>{a.label}</a> <span className="muted small">{ago(a.t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Roadmap ---------------- */
export function Roadmap() {
  const s = useProgress();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Course roadmap</div>
          <h1>From relational algebra to indexes</h1>
          <p className="muted">
            Order follows the syllabus (Weeks 1–6). Learn → check your understanding → practise → pass the module test → unlock what depends on it. Arrows show prerequisites.
          </p>
        </div>
      </header>
      <ol className="roadmap">
        {MODULES.map((m) => {
          const st = statusOf(s, m);
          const ls = lessonsOf(m.id);
          return (
            <li key={m.id} className={`road-item ${st}`}>
              <div className="road-dot">{st === 'mastered' ? <Icon name="check" size={16} /> : st === 'locked' ? <Icon name="lock" size={14} /> : m.num}</div>
              <div className="card road-card">
                <div className="card-h">
                  <div>
                    <div className="eyebrow">
                      {m.week} · {m.lectures}
                      {m.prereqs.length > 0 && <> · needs {m.prereqs.map((p) => moduleById(p)?.short).join(', ')}</>}
                    </div>
                    <h3>{st === 'locked' ? m.title : <a href={`#/module/${m.id}`}>{m.title}</a>}</h3>
                  </div>
                  <StatusPill status={st} />
                </div>
                <p className="muted">{m.blurb}</p>
                <div className="road-lessons">
                  {ls.map((l) => (
                    <a key={l.id} className={`lesson-chip ${s.lessons[l.id]?.done ? 'done' : ''} ${st === 'locked' ? 'disabled' : ''}`} href={st === 'locked' ? undefined : `#/lesson/${l.id}`} aria-disabled={st === 'locked'}>
                      {s.lessons[l.id]?.done && <Icon name="check" size={12} />} {l.title}
                    </a>
                  ))}
                </div>
                <div className="row gap wrap">
                  <span className="small muted">Lessons {pct(lessonCompletion(s, ls.map((l) => l.id)))}</span>
                  <span className="small muted">· Demonstrated mastery {pct(moduleMastery(s, m))}</span>
                  {s.passed[m.id] && <span className="small muted">· Test passed {ago(s.passed[m.id])}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- Lessons index ---------------- */
export function LessonsIndex() {
  const s = useProgress();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Lessons</div>
          <h1>All lessons</h1>
          <p className="muted">Completed lessons stay open for review at any time. Locked modules open after their prerequisite test is passed.</p>
        </div>
      </header>
      {MODULES.map((m) => {
        const st = statusOf(s, m);
        return (
          <section key={m.id} className="card">
            <div className="card-h">
              <h3>
                {m.num}. {m.title}
              </h3>
              <StatusPill status={st} />
            </div>
            <ul className="lesson-list">
              {lessonsOf(m.id).map((l) => {
                const checks = lessonChecks(l);
                const passed = checks.filter((c) => s.attempts.some((a) => a.q === c && a.ok)).length;
                return (
                  <li key={l.id}>
                    {st === 'locked' ? (
                      <span className="muted">
                        <Icon name="lock" size={13} /> {l.title}
                      </span>
                    ) : (
                      <a href={`#/lesson/${l.id}`}>{l.title}</a>
                    )}
                    <span className="small muted">
                      {l.minutes} min · checks {passed}/{checks.length}
                    </span>
                    {s.lessons[l.id]?.done ? <span className="pill st-mastered">Completed</span> : s.lessons[l.id]?.opened ? <span className="pill st-in-progress">Started</span> : null}
                    {l.provenance === 'supplementary' && <span className="pill supp">Supplementary</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- Module page ---------------- */
export function ModulePage({ id }: { id: string }) {
  const s = useProgress();
  const m = moduleById(id);
  if (!m) return <Empty title="Module not found" />;
  const st = statusOf(s, m);
  const ls = lessonsOf(m.id);
  const lt = lastTest(s, m.id);
  const nTest = QUESTIONS.filter((q) => q.module === m.id).length;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            Module {m.num} · {m.week} · {m.lectures}
          </div>
          <h1>{m.title}</h1>
          <p className="muted">{m.blurb}</p>
        </div>
        <StatusPill status={st} />
      </header>
      {st === 'locked' ? (
        <Locked m={m} />
      ) : (
        <>
          <div className="grid-2">
            <section className="card">
              <h3>Learning objectives</h3>
              <ul>
                {m.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              <h3>Lessons</h3>
              <ol className="lesson-list numbered">
                {ls.map((l) => (
                  <li key={l.id}>
                    <a href={`#/lesson/${l.id}`}>{l.title}</a>
                    <span className="small muted">{l.minutes} min</span>
                    {s.lessons[l.id]?.done && <span className="pill st-mastered">Completed</span>}
                    {l.provenance === 'supplementary' && <span className="pill supp">Supplementary</span>}
                  </li>
                ))}
              </ol>
            </section>
            <div className="stack">
              <section className="card">
                <h3>Mastery criteria</h3>
                <ul className="small">
                  <li>
                    Module test: {m.test.size} questions, pass with ≥ {pct(m.test.pass)}, no hints, one attempt per question.
                  </li>
                  {m.test.require?.map((r) => (
                    <li key={r.skill}>
                      Also required: at least {r.min} correct on <strong>{r.label}</strong>.
                    </li>
                  ))}
                  <li>Lesson completion (quick checks) is tracked separately and does not count as mastery.</li>
                </ul>
                {lt && (
                  <div className={`callout ${lt.passed ? 'tip' : 'warn'}`}>
                    <Icon name={lt.passed ? 'check' : 'warn'} size={18} />
                    <div>
                      Last test: {lt.correct}/{lt.total} {lt.passed ? '— passed' : '— not passed'}
                      {lt.unmet.length > 0 && <div className="small">{lt.unmet.join(' · ')}</div>}
                    </div>
                  </div>
                )}
                <div className="row gap wrap">
                  <a className="btn primary" href={`#/practice/${m.id}`}>
                    <Icon name="target" size={16} /> Practise ({nTest}+ questions)
                  </a>
                  <a className="btn ghost" href={`#/test/${m.id}`}>
                    <Icon name="exam" size={16} /> {s.passed[m.id] ? 'Retake module test' : 'Take module test'}
                  </a>
                </div>
              </section>
              <section className="card">
                <h3>Skills</h3>
                <ul className="plain skills">
                  {m.skills.map((k) => {
                    const ss = skillStat(s.attempts, k.id);
                    return (
                      <li key={k.id}>
                        <span className="grow">{k.label}</span>
                        <span className="small muted">{ss.total ? `${ss.correct}/${ss.n} recent` : ''}</span>
                        <LevelPill level={ss.level} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
          {m.formulas && (
            <section className="card">
              <h3>Key rules &amp; formulas</h3>
              <dl className="formulas">
                {m.formulas.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>
                      <Md md={f.md} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Lesson page ---------------- */
export function LessonPage({ id }: { id: string }) {
  const s = useProgress();
  const l = lessonById(id);
  const m = l ? moduleById(l.module) : undefined;
  const locked = m ? !isUnlocked(s, m) : false;
  useEffect(() => {
    if (l && !locked) {
      update((st) => openLesson(st, l.id, Date.now()));
      activity({ kind: 'lesson', label: `Opened “${l.title}”`, link: `#/lesson/${l.id}` });
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const checks = l ? lessonChecks(l) : [];
  const allPassed = checks.length > 0 && checksPassed(s, checks);
  useEffect(() => {
    if (l && allPassed && !s.lessons[l.id]?.done) {
      update((st) => completeLesson(st, l.id, Date.now()));
      activity({ kind: 'lesson', label: `Completed “${l.title}”`, link: `#/lesson/${l.id}` });
    }
  }, [allPassed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l || !m) return <Empty title="Lesson not found" />;
  if (locked) return <Locked m={m} />;
  const ls = lessonsOf(m.id);
  const idx = ls.findIndex((x) => x.id === l.id);
  const passedN = checks.filter((c) => s.attempts.some((a) => a.q === c && a.ok)).length;
  const done = !!s.lessons[l.id]?.done;
  const st = statusOf(s, m);
  return (
    <div className="lesson-layout">
      <article className="page lesson">
        <header className="page-head">
          <div>
            <div className="eyebrow">
              <a href={`#/module/${m.id}`}>
                Module {m.num} · {m.short}
              </a>{' '}
              · Lesson {idx + 1} of {ls.length} · {l.minutes} min
            </div>
            <h1>{l.title}</h1>
            <p className="lead">{l.summary}</p>
            <div className="src-row">
              <span className={`pill prov-${l.provenance ?? 'slides'}`}>{l.provenance === 'supplementary' ? 'Supplementary (not in the provided slides)' : l.provenance === 'explanatory' ? 'Explanatory extension' : 'Based on the lecture slides'}</span>
              {l.sources.map((r, i) => (
                <span key={i} className="src-chip" title={r.file}>
                  Source: {r.lecture}, slides {r.slides}
                </span>
              ))}
            </div>
            {l.provenanceNote && <div className="callout supp small-callout"><Icon name="layers" size={16} /><Md md={l.provenanceNote} /></div>}
          </div>
        </header>
        <section className="card objectives">
          <div className="eyebrow">By the end of this lesson you can</div>
          <ul>
            {l.objectives.map((o) => (
              <li key={o}>
                <Md md={o} />
              </li>
            ))}
          </ul>
        </section>
        <Blocks blocks={l.blocks} />
        <section className={`card completion ${done ? 'done' : ''}`}>
          {done ? (
            <div className="row gap">
              <Icon name="check" size={20} />
              <div>
                <strong>Lesson complete.</strong> <span className="muted">Completion is not mastery — practise and pass the module test to master {m.short}.</span>
              </div>
            </div>
          ) : (
            <div>
              <strong>
                Quick checks: {passedN} / {checks.length} answered correctly.
              </strong>{' '}
              <span className="muted">The lesson completes automatically when every quick check is correct (retries are fine).</span>
            </div>
          )}
          <div className="row gap wrap lesson-nav">
            {idx > 0 && (
              <a className="btn ghost" href={`#/lesson/${ls[idx - 1].id}`}>
                <Icon name="back" size={16} /> {ls[idx - 1].title}
              </a>
            )}
            {idx < ls.length - 1 ? (
              <a className="btn primary" href={`#/lesson/${ls[idx + 1].id}`}>
                Next: {ls[idx + 1].title} <Icon name="chevron" size={16} />
              </a>
            ) : (
              <>
                <a className="btn primary" href={`#/practice/${m.id}`}>
                  Practise {m.short}
                </a>
                <a className="btn ghost" href={`#/test/${m.id}`}>
                  Module test
                </a>
              </>
            )}
          </div>
        </section>
      </article>
      <aside className="context-panel" aria-label="Lesson context">
        <div className="card">
          <div className="eyebrow">Module status</div>
          <StatusPill status={st} />
          <div className="small muted mt">Lessons {pct(lessonCompletion(s, lessonIds(m.id)))} · mastery {pct(moduleMastery(s, m))}</div>
        </div>
        {l.keyTerms && (
          <div className="card">
            <div className="eyebrow">Key terms</div>
            <dl className="terms">
              {l.keyTerms.map((t) => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd>
                    <Md md={t.def} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {m.formulas && (
          <div className="card">
            <div className="eyebrow">Rules &amp; formulas</div>
            <dl className="terms">
              {m.formulas.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>
                    <Md md={f.md} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {m.examTips && (
          <div className="card">
            <div className="eyebrow">Exam tips</div>
            <ul className="small tips">
              {m.examTips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Labs ---------------- */
const LABS: { w: WidgetName; title: string; blurb: string; module: string }[] = [
  { w: 'sql', title: 'SQL playground', blurb: 'Run real SQL on the lecture datasets and see each clause’s intermediate result.', module: 'm2' },
  { w: 'ra', title: 'Relational algebra lab', blurb: 'Type σ / π / ⋈ / ∪ expressions and reveal intermediate relations.', module: 'm1' },
  { w: 'slotted', title: 'Slotted page', blurb: 'Insert, delete and compact tuples; watch record IDs stay stable.', module: 'm3' },
  { w: 'align', title: 'Word alignment', blurb: 'Padding vs reordering for a tuple’s attributes.', module: 'm3' },
  { w: 'lsm', title: 'LSM compaction', blurb: 'Merge two SSTables keeping the newest record per key.', module: 'm3' },
  { w: 'layout', title: 'NSM / DSM / PAX explorer', blurb: 'See exactly which values each layout must read for a query.', module: 'm4' },
  { w: 'compression', title: 'Compression lab', blurb: 'RLE, bitmap, delta, frame of reference, dictionary, bit packing.', module: 'm4' },
  { w: 'buffer', title: 'Buffer pool simulator', blurb: 'LRU, CLOCK, MRU, LRU-K with dirty pages — watch or predict.', module: 'm5' },
  { w: 'probe', title: 'Linear probing', blurb: 'Inserts, lookups and tombstone deletes.', module: 'm6' },
  { w: 'cuckoo', title: 'Cuckoo hashing', blurb: 'The lecture’s eviction chain, step by step.', module: 'm6' },
  { w: 'exthash', title: 'Extendible hashing', blurb: 'Global/local depth, splits and directory doubling.', module: 'm6' },
  { w: 'linhash', title: 'Linear hashing', blurb: 'Split pointer, overflow pages, hash₁/hash₂.', module: 'm6' },
  { w: 'bptree', title: 'B+Tree simulator', blurb: 'Insert, delete, search with split/merge explanations and invariant checks.', module: 'm7' },
  { w: 'bloom', title: 'Bloom filter', blurb: 'Insert and look up keys; find false positives.', module: 'm8' },
];

export function Labs({ name }: { name?: string }) {
  const lab = LABS.find((x) => x.w === name);
  if (lab)
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <div className="eyebrow">
              <a href="#/labs">Labs</a> · {moduleById(lab.module)?.short}
            </div>
            <h1>{lab.title}</h1>
            <p className="muted">{lab.blurb}</p>
          </div>
        </header>
        <Widget name={lab.w} />
      </div>
    );
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Practice labs</div>
          <h1>Interactive labs &amp; simulators</h1>
          <p className="muted">Free practice — always open, never graded. Every simulator follows the rules taught in the lectures, and the explanations come from the same code that grades the trace questions.</p>
        </div>
      </header>
      <div className="lab-grid">
        {LABS.map((x) => (
          <a key={x.w} className="card lab-card" href={`#/labs/${x.w}`}>
            <div className="eyebrow">{moduleById(x.module)?.short}</div>
            <h3>{x.title}</h3>
            <p className="muted small">{x.blurb}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Progress ---------------- */
export function ProgressPage() {
  const s = useProgress();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Progress &amp; statistics</div>
          <h1>What you have actually demonstrated</h1>
          <p className="muted">Lesson completion (you read it and passed its checks) is shown separately from mastery (recency-weighted accuracy on the module’s skills, and passing the module test).</p>
        </div>
      </header>
      <section className="card">
        <h3>Modules</h3>
        <div className="rel-scroll">
          <table className="mini wide">
            <thead>
              <tr>
                <th>Module</th>
                <th>Status</th>
                <th>Lessons completed</th>
                <th>Demonstrated mastery</th>
                <th>Best test</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => {
                const tests = s.tests.filter((t) => t.module === m.id);
                const best = tests.reduce((a, t) => Math.max(a, t.correct / t.total), 0);
                return (
                  <tr key={m.id}>
                    <td>
                      <a href={`#/module/${m.id}`}>{m.title}</a>
                    </td>
                    <td>
                      <StatusPill status={statusOf(s, m)} />
                    </td>
                    <td className="bar-cell">
                      <Bar value={lessonCompletion(s, lessonIds(m.id))} /> {pct(lessonCompletion(s, lessonIds(m.id)))}
                    </td>
                    <td className="bar-cell">
                      <Bar value={moduleMastery(s, m)} tone="good" /> {pct(moduleMastery(s, m))}
                    </td>
                    <td>{tests.length ? `${pct(best)} (${tests.length} attempt${tests.length > 1 ? 's' : ''})` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h3>Skills</h3>
        <div className="skill-grid">
          {MODULES.map((m) => (
            <div key={m.id} className="skill-mod">
              <div className="eyebrow">{m.short}</div>
              {m.skills.map((k) => {
                const ss = skillStat(s.attempts, k.id);
                return (
                  <div key={k.id} className="skill-line">
                    <span className="grow small">{k.label}</span>
                    <span className="small muted">{ss.total ? pct(ss.score) : ''}</span>
                    <LevelPill level={ss.level} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      <div className="grid-2">
        <section className="card">
          <h3>Module tests</h3>
          {s.tests.length === 0 ? (
            <Empty title="No module tests taken yet" />
          ) : (
            <table className="mini wide">
              <tbody>
                {[...s.tests].reverse().slice(0, 15).map((t, i) => (
                  <tr key={i}>
                    <td>{moduleById(t.module)?.short}</td>
                    <td>
                      {t.correct}/{t.total}
                    </td>
                    <td>{t.passed ? <span className="pill st-mastered">passed</span> : <span className="pill st-needs-review">not passed</span>}</td>
                    <td className="muted small">{ago(t.t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Practice exams</h3>
          {s.exams.length === 0 ? (
            <Empty title="No practice exams yet" />
          ) : (
            <table className="mini wide">
              <tbody>
                {[...s.exams].reverse().slice(0, 15).map((e) => (
                  <tr key={e.id}>
                    <td>{e.format}</td>
                    <td>
                      {e.correct}/{e.total} ({pct(e.correct / e.total)})
                    </td>
                    <td className="muted small">{Math.round(e.secs / 60)} min</td>
                    <td className="muted small">{ago(e.t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
export function Settings() {
  const s = useProgress();
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Preferences &amp; data</h1>
        </div>
      </header>
      <section className="card">
        <h3>Theme</h3>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={s.settings.theme === t} className={`seg-b ${s.settings.theme === t ? 'on' : ''}`} onClick={() => update((st) => ({ ...st, settings: { ...st.settings, theme: t } }))}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Your data</h3>
        <p className="muted small">
          Progress is stored only in this browser (localStorage key <code>db-midterm-studio.v1</code>): {s.attempts.length} answers, {Object.values(s.lessons).filter((x) => x.done).length} completed lessons, {s.tests.length} tests, {s.exams.length} exams. Nothing is sent anywhere.
          {!storageOk && ' ⚠ Storage is currently blocked, so progress will be lost on refresh.'}
        </p>
        <h4>Reset all progress</h4>
        <p className="small">This permanently deletes every answer, lesson completion, test and exam result. Type RESET to confirm.</p>
        <div className="row gap">
          <input className="input sm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" aria-label="Type RESET to confirm" />
          <button
            className="btn danger"
            disabled={confirm !== 'RESET'}
            onClick={() => {
              resetProgress();
              setConfirm('');
              setMsg('All progress was reset.');
            }}
          >
            Reset progress
          </button>
        </div>
        {msg && <div className="saved">{msg}</div>}
      </section>
    </div>
  );
}

/* ---------------- Sources & scope ---------------- */
export function Sources() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Sources &amp; scope</div>
          <h1>What this app is based on</h1>
          <p className="muted">The syllabus defines the scope; the lecture slides provide the details. Every lesson shows its source slides. Slide numbers are the numbers printed in each slide’s footer.</p>
        </div>
      </header>
      <section className="card">
        <h3>Midterm scope (Databases_Syllabus.pdf)</h3>
        <p>
          “Midterm in week 7: weeks 1–6” — relational reasoning, SQL, storage, buffering and indexing. Exams assess “algorithm traces, invariants, cost calculations”. Weeks 8–14 (query execution, optimization, transactions, MVCC, logging, recovery) are for the final exam and are not covered here.
        </p>
        <table className="mini wide">
          <thead>
            <tr>
              <th>Syllabus week</th>
              <th>Topic</th>
              <th>Lecture file</th>
              <th>App module</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Week 1', 'Relational Model and Algebra', 'lecture1-1.pdf', 'm1'],
              ['Week 2', 'Modern SQL', 'lecture2-1.pdf', 'm2'],
              ['Week 3', 'Database Storage', 'lecture3-1.pdf + lecture4-1.pdf (slides 1–45)', 'm3, m4'],
              ['Week 4', 'Buffer Pool Management', 'lecture4-1.pdf (slides 46–83)', 'm5'],
              ['Week 5', 'Hash Table Indexes', 'lecture5-1.pdf', 'm6'],
              ['Week 6', 'B+ Tree Indexes (+ filters)', 'lecture6.pdf, lecture7.pdf', 'm7, m8'],
            ].map((r) => (
              <tr key={r[0]}>
                <td>{r[0]}</td>
                <td>{r[1]}</td>
                <td>
                  <code>{r[2]}</code>
                </td>
                <td>{r[3]
                  .split(', ')
                  .map((id) => moduleById(id)?.short)
                  .join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>How content is labelled</h3>
        <ul>
          <li>
            <span className="pill prov-slides">Based on the lecture slides</span> — definitions, rules and worked examples come from the cited slides.
          </li>
          <li>
            <span className="pill prov-explanatory">Explanatory extension</span> — extra examples or calculations written to explain slide content (e.g. B+Tree height estimates).
          </li>
          <li>
            <span className="pill prov-supplementary">Supplementary</span> — listed in the syllabus but not covered by any provided slide (NULL/three-valued logic, index latch crabbing). Taught from standard material and clearly marked.
          </li>
          <li>All practice and exam questions are written for this app. None of them are official exam questions.</li>
        </ul>
      </section>
      <section className="card">
        <h3>Gaps and discrepancies found in the materials</h3>
        <ul className="small">
          <li>No sample exam, past paper or assignment specification is in the folder → the exam format is unknown, so Exam Mode is a labelled practice format.</li>
          <li>Syllabus Week 6 lists latch coupling, safe nodes and deadlock avoidance; no provided slide covers them (supplementary lesson in B+Trees).</li>
          <li>Syllabus Week 2 lists NULL and three-valued logic; Lecture 2’s slides show no NULL examples (supplementary lesson in SQL).</li>
          <li>Lecture 7 (Indexes &amp; Filters) is not named in the syllabus week list; it is included because the midterm covers “indexing” and Week 5 mentions filters.</li>
          <li>Lecture 2 slide 33 shows the result “53688 Bieber”, but slide 6 lists 53688 as Taylor. The app uses the slide-6 data.</li>
          <li>Lecture 4 slide 35 (sorted RLE) shows (N,7,2); with the 0-based offsets on the same slide the run starts at 6 → (N,6,2).</li>
          <li>Lecture 4 slide 37 shows 191 as 181 in the compressed column (typo).</li>
          <li>Lecture 4 slide 61 draws the newly loaded page with ref = 0 although the text says an access sets the bit to 1. The simulator follows the drawing by default and lets you switch.</li>
          <li>Lecture 6 slide 17: the first frame shows the right leaf as [9,10,12] but later frames as [9,12,14].</li>
        </ul>
      </section>
    </div>
  );
}
