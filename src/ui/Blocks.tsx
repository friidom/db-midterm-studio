import { useState } from 'react';
import type { Block, Concept, Step } from '../lib/types';
import { getQuestion } from '../content';
import { Code, Icon, Md, RelTable } from './kit';
import { QuestionCard } from './Question';
import { Widget } from './widgets';

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </>
  );
}

const CALLOUT_ICON = { tip: 'bulb', warn: 'warn', exam: 'star', info: 'info', supp: 'layers' } as const;
const CALLOUT_TITLE = { tip: 'Tip', warn: 'Watch out', exam: 'Exam focus', info: 'Note', supp: 'Supplementary material' } as const;

export function BlockView({ b }: { b: Block }) {
  switch (b.k) {
    case 'md':
      return <Md md={b.md} />;
    case 'callout':
      return (
        <div className={`callout ${b.tone}`}>
          <Icon name={CALLOUT_ICON[b.tone]} size={18} />
          <div>
            <div className="callout-title">{b.title ?? CALLOUT_TITLE[b.tone]}</div>
            <Md md={b.md} />
          </div>
        </div>
      );
    case 'table':
      return <RelTable t={b.t} />;
    case 'tables':
      return (
        <figure className="tables">
          <div className="tables-row">
            {b.ts.map((t, i) => (
              <RelTable key={i} t={t} compact />
            ))}
          </div>
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    case 'code':
      return <Code code={b.code} lang={b.lang} title={b.title} />;
    case 'concept':
      return <ConceptCard c={b.c} />;
    case 'steps':
      return <Steps title={b.title} steps={b.steps} />;
    case 'check': {
      const q = getQuestion(b.q);
      return q ? (
        <div className="check-wrap">
          <div className="check-label">
            <Icon name="target" size={16} /> Quick check
          </div>
          <QuestionCard q={q} mode="check" />
        </div>
      ) : null;
    }
    case 'widget':
      return <Widget name={b.w} props={b.props} />;
    case 'compare':
      return (
        <figure className="compare">
          {b.title && <figcaption>{b.title}</figcaption>}
          <div className="rel-scroll">
            <table>
              <thead>
                <tr>
                  {b.cols.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{j === 0 ? <strong><Md md={c} /></strong> : <Md md={c} />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      );
    case 'diagram':
      return (
        <figure className="diagram">
          <pre>{b.d}</pre>
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
  }
}

function Steps({ title, steps }: { title: string; steps: Step[] }) {
  const [n, setN] = useState(1);
  return (
    <div className="steps">
      <div className="steps-title">
        <Icon name="play" size={14} /> {title}
      </div>
      <ol>
        {steps.slice(0, n).map((s, i) => (
          <li key={i} className="step">
            <Md md={s.md} />
            {s.block && <BlockView b={s.block} />}
          </li>
        ))}
      </ol>
      <div className="row gap">
        {n < steps.length ? (
          <>
            <button className="btn ghost sm" onClick={() => setN(n + 1)}>
              Next step ({n}/{steps.length})
            </button>
            <button className="btn link sm" onClick={() => setN(steps.length)}>
              Show all
            </button>
          </>
        ) : (
          <span className="muted small">All {steps.length} steps shown.</span>
        )}
      </div>
    </div>
  );
}

export function ConceptCard({ c }: { c: Concept }) {
  const q = c.check ? getQuestion(c.check) : undefined;
  return (
    <section className="concept">
      <h3 className="concept-title">{c.title}</h3>
      <div className="concept-grid">
        <div className="cpart">
          <div className="clabel">
            <span className="cnum">1</span> Intuition
          </div>
          <Md md={c.intuition} />
        </div>
        <div className="cpart">
          <div className="clabel">
            <span className="cnum">2</span> Why it matters
          </div>
          <Md md={c.why} />
        </div>
      </div>
      <div className="cpart definition">
        <div className="clabel">
          <span className="cnum">3</span> Formal definition
        </div>
        <Md md={c.definition} />
      </div>
      {c.example && (
        <div className="cpart">
          <div className="clabel">
            <span className="cnum">4</span> Example
          </div>
          <Blocks blocks={c.example} />
        </div>
      )}
      {c.walkthrough && (
        <div className="cpart">
          <div className="clabel">
            <span className="cnum">5</span> Step-by-step
          </div>
          <Steps title={c.walkthrough.title} steps={c.walkthrough.steps} />
        </div>
      )}
      {c.mistakes && (
        <div className="cpart">
          <div className="clabel">
            <span className="cnum">6</span> Common mistakes
          </div>
          <ul className="mistakes">
            {c.mistakes.map((m, i) => (
              <li key={i}>
                <div className="mk-wrong">
                  <Icon name="x" size={14} /> <Md md={m.wrong} />
                </div>
                <div className="mk-right">
                  <Icon name="check" size={14} /> <Md md={m.right} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q && (
        <div className="cpart check-wrap">
          <div className="clabel">
            <span className="cnum">7</span> Quick check
          </div>
          <QuestionCard q={q} mode="check" />
        </div>
      )}
    </section>
  );
}
