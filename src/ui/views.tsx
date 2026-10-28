import { useMemo, useState } from 'react';
import type { TraceSpec } from '../lib/types';
import type { BufState } from '../lib/sim/buffer';
import { kDistance } from '../lib/sim/buffer';
import { bits, lhSize, type EHState, type LHState, type PSlot } from '../lib/sim/hashing';
import { levels, type BTree } from '../lib/sim/bptree';
import { buildTrace, checkAsk, type SimState } from '../lib/trace';
import { Icon, Md } from './kit';

export function BufferView({ s, policy, highlight }: { s: BufState; policy: string; highlight?: number }) {
  const resident = s.frames.filter((f) => f.page !== null).map((f) => f.page as number);
  const lru = [...resident].sort((a, b) => s.last[a] - s.last[b]);
  return (
    <div className="sim-view">
      <div className="frames">
        {s.frames.map((f, i) => (
          <div key={i} className={`frame ${f.page === null ? 'free' : ''} ${highlight === i ? 'hl' : ''}`}>
            <div className="frame-id">
              frame {i}
              {policy === 'CLOCK' && s.hand === i && <span className="hand" title="clock hand">◀ hand</span>}
            </div>
            <div className="frame-page">{f.page === null ? 'free' : `page ${f.page}`}</div>
            <div className="frame-meta">
              {f.page !== null && <span className={`tag ${f.dirty ? 'bad' : ''}`}>{f.dirty ? 'dirty' : 'clean'}</span>}
              {policy === 'CLOCK' && f.page !== null && <span className="tag">ref={f.ref}</span>}
            </div>
          </div>
        ))}
      </div>
      {policy !== 'CLOCK' && resident.length > 0 && (
        <div className="sim-note">
          {policy === 'LRU2' ? (
            <>
              Access history (t = time): {resident.map((p) => `p${p}: [${(s.hist[p] ?? []).join(', ')}] → dist ${kDistance(s, p, s.t + 1) === Infinity ? '+∞' : kDistance(s, p, s.t + 1)}`).join(' · ')}
            </>
          ) : (
            <>
              Recency (oldest → newest): <strong>{lru.map((p) => `p${p}`).join(' → ')}</strong>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ProbeView({ s, probes }: { s: PSlot[]; probes?: number[] }) {
  return (
    <div className="slots">
      {s.map((x, i) => (
        <div key={i} className={`slot ${x === 'empty' ? 'free' : x === 'tomb' ? 'tomb' : ''} ${probes?.includes(i) ? 'hl' : ''}`}>
          <div className="slot-i">{i}</div>
          <div className="slot-v">{x === 'empty' ? '—' : x === 'tomb' ? '✝ tomb' : x.key}</div>
        </div>
      ))}
    </div>
  );
}

export function EHView({ s }: { s: EHState }) {
  return (
    <div className="eh">
      <div className="eh-dir">
        <div className="eh-head">global depth {s.global}</div>
        {s.dir.map((b, i) => (
          <div key={i} className="eh-slot">
            <code>{bits(i, s.global) || '·'}</code> → B{b}
          </div>
        ))}
      </div>
      <div className="eh-buckets">
        {s.buckets.map((b, i) => (
          <div key={i} className="bucket">
            <div className="bucket-h">
              B{i} <span className="tag">local {b.local}</span>
            </div>
            {Array.from({ length: s.cap }, (_, j) => (
              <div key={j} className={`bucket-e ${b.keys[j] ? '' : 'free'}`}>
                {b.keys[j] ? (
                  <>
                    <code>{b.keys[j].h}</code> {b.keys[j].k}
                  </>
                ) : (
                  '—'
                )}
              </div>
            ))}
            {b.keys.slice(s.cap).map((e, j) => (
              <div key={`o${j}`} className="bucket-e over">
                <code>{e.h}</code> {e.k}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LHView({ s }: { s: LHState }) {
  const n = lhSize(s);
  return (
    <div className="lh">
      <div className="sim-note">
        hash₁(k) = k mod {n} · hash₂(k) = k mod {2 * n} · split pointer = <strong>{s.next}</strong>
      </div>
      {s.buckets.map((b, i) => {
        const pages: number[][] = [];
        for (let j = 0; j < Math.max(1, Math.ceil(b.length / s.cap)); j++) pages.push(b.slice(j * s.cap, (j + 1) * s.cap));
        return (
          <div key={i} className="lh-row">
            <div className="lh-idx">
              {s.next === i && <span className="hand">▶</span>}
              {i}
            </div>
            {pages.map((pg, j) => (
              <div key={j} className={`lh-page ${j > 0 ? 'over' : ''}`}>
                {Array.from({ length: s.cap }, (_, k) => (
                  <span key={k} className={pg[k] === undefined ? 'free' : ''}>
                    {pg[k] ?? '—'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function TreeView({ t }: { t: BTree }) {
  const lv = levels(t);
  return (
    <div className="tree" role="img" aria-label="B+Tree">
      {lv.map((row, i) => (
        <div key={i} className={`tree-row ${i === lv.length - 1 ? 'leaves' : ''}`}>
          {row.map((n, j) => (
            <div key={j} className={`node ${n.leaf ? 'leaf' : ''}`}>
              {Array.from({ length: t.maxKeys }, (_, k) => (
                <span key={k} className={n.keys[k] === undefined ? 'free' : ''}>
                  {n.keys[k] ?? ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="tree-caption">{lv.length} level{lv.length > 1 ? 's' : ''} · max {t.maxKeys} keys per node · leaves are linked left → right</div>
    </div>
  );
}

export function BloomView({ s, mark }: { s: number[]; mark?: number[] }) {
  return (
    <div className="slots bloom">
      {s.map((b, i) => (
        <div key={i} className={`slot ${b ? 'on' : 'free'} ${mark?.includes(i) ? 'hl' : ''}`}>
          <div className="slot-i">{i}</div>
          <div className="slot-v">{b}</div>
        </div>
      ))}
    </div>
  );
}

export function SimStateView({ st }: { st: SimState }) {
  switch (st.sim) {
    case 'buffer':
      return <BufferView s={st.s} policy={st.policy} />;
    case 'probe':
      return <ProbeView s={st.s} />;
    case 'exthash':
      return <EHView s={st.s} />;
    case 'linhash':
      return <LHView s={st.s} />;
    case 'bptree':
      return <TreeView t={st.s} />;
    case 'bloom':
      return <BloomView s={st.s} />;
  }
}

/** Step-by-step prediction runner. The diagram updates only after the learner submits a step. */
export function TraceRunner({ spec, onFinish, disabled }: { spec: TraceSpec; onFinish?: (score: number) => void; disabled?: boolean }) {
  const steps = useMemo(() => buildTrace(spec), [spec]);
  const [i, setI] = useState(0);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const st = steps[i];
  const totalAsks = steps.reduce((a, s) => a + s.asks.length, 0);
  if (!st) return null;
  const submit = () => {
    const ok = st.asks.filter((a) => checkAsk(a, vals[a.key] ?? '')).length;
    setRight((r) => r + ok);
    setTotal((t) => t + st.asks.length);
    setChecked(true);
  };
  const next = () => {
    if (i + 1 >= steps.length) {
      setDone(true);
      onFinish?.(totalAsks ? right / totalAsks : 1);
      return;
    }
    setI(i + 1);
    setVals({});
    setChecked(false);
  };
  const allAnswered = st.asks.every((a) => (vals[a.key] ?? '').trim() !== '');
  return (
    <div className="trace">
      <div className="trace-head">
        <span className="tag">
          Step {i + 1} / {steps.length}
        </span>
        <strong>{st.title}</strong>
        <span className="muted trace-score">
          {right}/{total} predictions correct
        </span>
      </div>
      <div className="trace-state">
        <div className="trace-label">{checked ? 'After this step' : 'Current state (before the step)'}</div>
        <SimStateView st={checked ? st.after : st.before} />
      </div>
      <div className="asks">
        {st.asks.map((a) => {
          const v = vals[a.key] ?? '';
          const ok = checked && checkAsk(a, v);
          return (
            <div key={a.key} className={`ask ${checked ? (ok ? 'ok' : 'bad') : ''}`}>
              <label className="ask-label">{a.label}</label>
              {a.kind === 'choice' ? (
                <div className="choice-row" role="radiogroup" aria-label={a.label}>
                  {a.options!.map((o) => (
                    <button key={o} type="button" role="radio" aria-checked={v === o} className={`chip ${v === o ? 'on' : ''}`} disabled={checked || disabled} onClick={() => setVals({ ...vals, [a.key]: o })}>
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="input sm"
                  inputMode={a.kind === 'number' ? 'numeric' : 'text'}
                  placeholder={a.placeholder ?? (a.kind === 'number' ? 'number' : 'answer')}
                  value={v}
                  disabled={checked || disabled}
                  onChange={(e) => setVals({ ...vals, [a.key]: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && allAnswered && !checked && submit()}
                />
              )}
              {checked && (
                <div className="ask-res">
                  <Icon name={ok ? 'check' : 'x'} size={14} /> {ok ? 'Correct' : <>Correct answer: <strong>{a.answer}</strong></>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {checked && (
        <div className="trace-explain">
          {st.explain.map((e, k) => (
            <Md key={k} md={e} />
          ))}
        </div>
      )}
      {!done && (
        <div className="row gap">
          {!checked ? (
            <button className="btn primary" disabled={!allAnswered || disabled} onClick={submit}>
              Check step
            </button>
          ) : (
            <button className="btn primary" onClick={next}>
              {i + 1 >= steps.length ? 'Finish trace' : 'Next step'} <Icon name="chevron" size={16} />
            </button>
          )}
        </div>
      )}
      {done && (
        <div className="trace-done">
          Trace complete: <strong>{right}</strong> of <strong>{totalAsks}</strong> predictions correct ({Math.round((right / Math.max(1, totalAsks)) * 100)}%).
        </div>
      )}
    </div>
  );
}
