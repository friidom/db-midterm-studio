import { useEffect, useMemo, useState } from 'react';
import type { WidgetName } from '../lib/types';
import { DATASETS, relDb } from '../content/datasets';
import { openDataset, execQuery, translateDialect, type QResult } from '../lib/sql';
import { runRA, colLabels, type RANode } from '../lib/ra';
import { parseRefs, simulateBuffer, bufSummary, POLICY_LABEL, refLabel, type Policy } from '../lib/sim/buffer';
import { parseProbeOps, runProbe, cuckooInsert, ehFromSpec, ehInsert, lhApply, parseLHOps, bloomPositions, bloomApply, type LHState, type EHState } from '../lib/sim/hashing';
import { parseTree, emptyTree, insert as btInsert, remove as btRemove, invariants, search, type BTree } from '../lib/sim/bptree';
import { rle, bitmapEncode, deltaEncode, frameOfReference, dictionaryEncode, bitsNeeded, alignWithPadding, alignWithReordering, layoutAccess, lsmCompact, lsmText, newPage, slottedInsert, slottedDelete, slottedCompact, contiguousFree, fragmentedBytes, slotArrayEnd, type Layout, type LayoutQuery, type SlottedPage, type LsmRec } from '../lib/sim/storage';
import { Icon, Md, RelTable } from './kit';
import { PipelineView, RaInput, RaSteps, SchemaView } from './Question';
import { BloomView, BufferView, EHView, LHView, ProbeView, TraceRunner, TreeView } from './views';

type P = Record<string, unknown> | undefined;
const str = (p: P, k: string, d: string) => (typeof p?.[k] === 'string' ? (p[k] as string) : d);
const num = (p: P, k: string, d: number) => (typeof p?.[k] === 'number' ? (p[k] as number) : d);

export function Widget({ name, props }: { name: WidgetName; props?: P }) {
  const W = { sql: SqlLab, ra: RaLab, buffer: BufferLab, probe: ProbeLab, cuckoo: CuckooLab, exthash: ExtHashLab, linhash: LinHashLab, bptree: BPTreeLab, bloom: BloomLab, layout: LayoutExplorer, slotted: SlottedLab, compression: CompressionLab, align: AlignLab, lsm: LsmLab }[name];
  return (
    <div className="widget">
      <W p={props} />
    </div>
  );
}

function StepNav({ i, n, setI, label }: { i: number; n: number; setI: (i: number) => void; label?: string }) {
  return (
    <div className="stepnav">
      <button className="btn ghost sm" disabled={i <= 0} onClick={() => setI(i - 1)} aria-label="Previous step">
        <Icon name="back" size={14} />
      </button>
      <span className="muted small">
        {label ?? 'Step'} {i + 1} / {n}
      </span>
      <button className="btn ghost sm" disabled={i >= n - 1} onClick={() => setI(i + 1)} aria-label="Next step">
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

const Err = ({ e }: { e: string }) => <div className="err">{e}</div>;

/* ---------------- SQL lab ---------------- */
export function SqlLab({ p }: { p?: P }) {
  const [db, setDb] = useState(str(p, 'db', 'lecture2'));
  const [q, setQ] = useState(str(p, 'query', "SELECT AVG(gpa), COUNT(sid)\nFROM student\nWHERE login LIKE '%@cs';"));
  const [res, setRes] = useState<{ r?: QResult; err?: string; notes?: string[]; ran?: string } | null>(null);
  const run = async () => {
    const tr = translateDialect(q);
    if (tr.blocker) return setRes({ err: tr.blocker });
    const d = await openDataset(db);
    try {
      setRes({ r: execQuery(d, tr.sql), notes: tr.notes, ran: tr.sql });
    } catch (e) {
      setRes({ err: (e as Error).message });
    } finally {
      d.close();
    }
  };
  const sqlDbs = DATASETS.filter((d) => ['lecture2', 'campus', 'music', 'rs', 'rsj'].includes(d.id));
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>SQL playground</strong>
        <select className="select" value={db} onChange={(e) => setDb(e.target.value)} aria-label="Dataset">
          {sqlDbs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>
      <SchemaView db={db} />
      <textarea className="code-input" rows={Math.max(4, q.split('\n').length + 1)} spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} aria-label="SQL" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && run()} />
      <div className="row gap">
        <button className="btn primary" onClick={run}>
          <Icon name="play" size={14} /> Run query
        </button>
        <span className="muted small">Real SQLite (sql.js) running locally in your browser · each run starts from a fresh copy of the data</span>
      </div>
      {res?.err && <Err e={res.err} />}
      {res?.r && <RelTable t={{ title: `Result — ${res.r.rows.length} row(s)`, cols: res.r.cols, rows: res.r.rows }} />}
      {res?.notes?.map((n, i) => (
        <div key={i} className="muted small">
          {n}
        </div>
      ))}
      {res?.ran && <PipelineView key={res.ran} db={db} sql={res.ran} />}
    </div>
  );
}

/* ---------------- RA lab ---------------- */
export function RaLab({ p }: { p?: P }) {
  const [db, setDb] = useState(str(p, 'db', 'rs'));
  const [expr, setExpr] = useState(str(p, 'expr', 'R ∪ S'));
  const [node, setNode] = useState<RANode | null>(null);
  const [err, setErr] = useState('');
  const go = () => {
    try {
      setNode(runRA(expr, relDb(db)));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      setNode(null);
    }
  };
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Relational algebra lab</strong>
        <select className="select" value={db} onChange={(e) => (setDb(e.target.value), setNode(null))} aria-label="Relations">
          {DATASETS.filter((d) => ['rs', 'rsj', 'r35', 'music', 'lecture2'].includes(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>
      <RaInput db={db} value={expr} onChange={setExpr} onSubmit={go} />
      <button className="btn primary" onClick={go}>
        Show steps
      </button>
      {err && <Err e={err} />}
      {node && (
        <>
          <div className="muted small">Predict each intermediate relation, then reveal it. Results use set semantics (no duplicates).</div>
          <RaSteps key={expr + db} node={node} />
          <RelTable t={{ title: `Final result (${node.rel.rows.length} tuples)`, cols: colLabels(node.rel), rows: node.rel.rows }} />
        </>
      )}
    </div>
  );
}

/* ---------------- buffer pool ---------------- */
export function BufferLab({ p }: { p?: P }) {
  const [policy, setPolicy] = useState<Policy>((str(p, 'policy', 'LRU') as Policy) ?? 'LRU');
  const [frames, setFrames] = useState(num(p, 'frames', 3));
  const [refs, setRefs] = useState(str(p, 'refs', 'R1 R2 R3 W1 R4 R2 R5 R1'));
  const [newRef, setNewRef] = useState<0 | 1>(0);
  const [i, setI] = useState(0);
  const [predict, setPredict] = useState(false);
  const parsed = useMemo(() => {
    try {
      return { steps: simulateBuffer(policy, frames, parseRefs(refs), { newRef }) };
    } catch (e) {
      return { err: (e as Error).message };
    }
  }, [policy, frames, refs, newRef]);
  useEffect(() => setI(0), [policy, frames, refs, newRef]);
  const steps = parsed.steps ?? [];
  const st = steps[Math.min(i, steps.length - 1)];
  const sum = bufSummary(steps);
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Buffer pool simulator</strong>
        <select className="select" value={policy} onChange={(e) => setPolicy(e.target.value as Policy)} aria-label="Policy">
          {(Object.keys(POLICY_LABEL) as Policy[]).map((k) => (
            <option key={k} value={k}>
              {POLICY_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="small">
          frames{' '}
          <select className="select" value={frames} onChange={(e) => setFrames(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {policy === 'CLOCK' && (
          <label className="small">
            new page ref{' '}
            <select className="select" value={newRef} onChange={(e) => setNewRef(Number(e.target.value) as 0 | 1)}>
              <option value={0}>0 (as drawn on L4 slide 61)</option>
              <option value={1}>1 (some textbooks)</option>
            </select>
          </label>
        )}
      </div>
      <input className="input code-font" value={refs} onChange={(e) => setRefs(e.target.value)} aria-label="Page references (R = read, W = write)" />
      {parsed.err && <Err e={parsed.err} />}
      <div className="row gap">
        <button className={`btn ${predict ? 'ghost' : 'primary'} sm`} onClick={() => setPredict(false)}>
          Watch it run
        </button>
        <button className={`btn ${predict ? 'primary' : 'ghost'} sm`} onClick={() => setPredict(true)}>
          Predict each step
        </button>
      </div>
      {predict ? (
        <TraceRunner key={`${policy}${frames}${refs}${newRef}`} spec={{ sim: 'buffer', policy, frames, refs, newRef }} />
      ) : (
        st && (
          <>
            <div className="refstrip">
              {steps.map((s, k) => (
                <button key={k} className={`chip ${k === i ? 'on' : ''} ${k <= i ? (s.hit ? 'hitc' : 'missc') : ''}`} onClick={() => setI(k)}>
                  {refLabel(s.ref)}
                </button>
              ))}
            </div>
            <StepNav i={i} n={steps.length} setI={setI} label="Request" />
            <BufferView s={st.after} policy={policy} highlight={st.frame} />
            <div className={`trace-explain ${st.hit ? 'ok' : ''}`}>
              {st.explain.map((e, k) => (
                <Md key={k} md={e} />
              ))}
            </div>
            <div className="muted small">
              Totals: {sum.hits} hits · {sum.misses} misses · evicted [{sum.evicted.join(', ') || '—'}] · {sum.writes} dirty write-back(s)
            </div>
          </>
        )
      )}
    </div>
  );
}

/* ---------------- hashing ---------------- */
export function ProbeLab({ p }: { p?: P }) {
  const [size, setSize] = useState(num(p, 'size', 7));
  const [ops, setOps] = useState(str(p, 'ops', '+A:2 +B:0 +C:2 +D:3 +E:5 +F:5 -C:2 ?D:3 +G:3'));
  const [i, setI] = useState(0);
  const r = useMemo(() => {
    try {
      return { steps: runProbe(size, parseProbeOps(ops)) };
    } catch (e) {
      return { err: (e as Error).message };
    }
  }, [size, ops]);
  useEffect(() => setI(0), [size, ops]);
  const st = r.steps?.[Math.min(i, r.steps.length - 1)];
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Linear probe hashing</strong>
        <label className="small">
          slots <input className="input xs" type="number" min={3} max={16} value={size} onChange={(e) => setSize(Math.max(3, Math.min(16, Number(e.target.value) || 3)))} />
        </label>
      </div>
      <input className="input code-font" value={ops} onChange={(e) => setOps(e.target.value)} aria-label="Operations" />
      <div className="muted small">Format: +KEY:home (insert), ?KEY:home (lookup), -KEY:home (delete) — home = hash(key) % slots.</div>
      {r.err && <Err e={r.err} />}
      {st && (
        <>
          <StepNav i={i} n={r.steps!.length} setI={setI} label="Operation" />
          <ProbeView s={st.after} probes={st.probes} />
          <div className="trace-explain">
            <Md md={st.explain} />
          </div>
        </>
      )}
    </div>
  );
}

export function CuckooLab() {
  const hashes: Record<string, [number, number]> = { A: [2, 5], B: [2, 0], C: [2, 0] };
  const steps = useMemo(() => {
    let t: (string | null)[] = Array(7).fill(null);
    return ['A', 'B', 'C'].map((k) => {
      const s = cuckooInsert(t, k, hashes);
      t = s.after;
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [i, setI] = useState(0);
  const st = steps[i];
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Cuckoo hashing — Lecture 5, slide 21</strong>
      </div>
      <div className="muted small">hash₁/hash₂: A → 2/5 · B → 2/0 · C → 2/0 (one table, two hash functions)</div>
      <StepNav i={i} n={steps.length} setI={setI} label="Put" />
      <ProbeView s={st.after.map((x) => (x ? { key: x } : 'empty'))} probes={[st.h1, st.h2]} />
      <div className="trace-explain">
        {st.moves.map((m, k) => (
          <Md key={k} md={m} />
        ))}
      </div>
    </div>
  );
}

const EH_LECTURE = '1:A=00010,X=01110 | 2:Y=10101,Z=10011 | 2:W=11010';
export function ExtHashLab({ p }: { p?: P }) {
  const [ops, setOps] = useState(str(p, 'ops', 'B=10111 C=10100'));
  const [i, setI] = useState(0);
  const r = useMemo(() => {
    try {
      let s: EHState = ehFromSpec(EH_LECTURE, 3, 2);
      const steps = ops
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((tok) => {
          const [k, h] = tok.split('=');
          if (!h || !/^[01]+$/.test(h)) throw new Error(`Use KEY=bits, e.g. C=10100 (got “${tok}”)`);
          const st = ehInsert(s, k, h.padEnd(5, '0'));
          s = st.after;
          return st;
        });
      return { steps, start: ehFromSpec(EH_LECTURE, 3, 2) };
    } catch (e) {
      return { err: (e as Error).message, start: ehFromSpec(EH_LECTURE, 3, 2) };
    }
  }, [ops]);
  useEffect(() => setI(0), [ops]);
  const st = r.steps?.[Math.min(i, (r.steps?.length ?? 1) - 1)];
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Extendible hashing (starts from the Lecture 5 slide 26 state)</strong>
      </div>
      <input className="input code-font" value={ops} onChange={(e) => setOps(e.target.value)} aria-label="Inserts KEY=hashbits" />
      {r.err && <Err e={r.err} />}
      {!st && <EHView s={r.start} />}
      {st && (
        <>
          <StepNav i={i} n={r.steps!.length} setI={setI} label="Insert" />
          <EHView s={st.after} />
          <div className="trace-explain">
            {st.explain.map((e, k) => (
              <Md key={k} md={e} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function LinHashLab({ p }: { p?: P }) {
  const [ops, setOps] = useState(str(p, 'ops', '?6 +17 ?20 ?9 -20 +21'));
  const [i, setI] = useState(0);
  const r = useMemo(() => {
    try {
      let s: LHState = { n0: 4, level: 0, next: 0, cap: 3, buckets: [[8, 20], [5, 9, 13], [6], [7, 11]] };
      const steps = parseLHOps(ops).map(({ op, key }) => {
        const st = lhApply(s, op, key);
        s = st.after;
        return st;
      });
      return { steps };
    } catch (e) {
      return { err: (e as Error).message };
    }
  }, [ops]);
  useEffect(() => setI(0), [ops]);
  const st = r.steps?.[Math.min(i, r.steps.length - 1)];
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Linear hashing (starts from the Lecture 5 slide 28 state)</strong>
      </div>
      <input className="input code-font" value={ops} onChange={(e) => setOps(e.target.value)} aria-label="Operations" />
      <div className="muted small">+k insert · ?k lookup · -k delete. Page capacity 3; split pointer starts at 0.</div>
      {r.err && <Err e={r.err} />}
      {st && (
        <>
          <StepNav i={i} n={r.steps!.length} setI={setI} label="Operation" />
          <LHView s={st.after} />
          <div className="trace-explain">
            {st.explain.map((e, k) => (
              <Md key={k} md={e} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- B+Tree ---------------- */
const BT_PRESETS: { label: string; max: number; spec: string }[] = [
  { label: 'Lecture 6 slide 13 (max 3 keys)', max: 3, spec: '[4 12] ([1 3] [5 9 10] [12 13])' },
  { label: 'Lecture 6 slide 14 (max 4 keys)', max: 4, spec: '[5 9 13 19] ([1 3] [5 7] [9 11] [13 14 15] [20 21 23])' },
  { label: 'Lecture 6 slide 18 (max 4 keys)', max: 4, spec: '[13] ([5 9] ([1 3] [5 7] [9 11]) [17 21] ([13 15] [17 19 20] [21 23]))' },
  { label: 'Empty tree (max 3 keys)', max: 3, spec: '' },
  { label: 'Empty tree (max 4 keys)', max: 4, spec: '' },
];

export function BPTreeLab({ p }: { p?: P }) {
  const startIdx = num(p, 'preset', 0);
  const [preset, setPreset] = useState(startIdx);
  const make = (k: number): BTree => (BT_PRESETS[k].spec ? parseTree(BT_PRESETS[k].spec, BT_PRESETS[k].max) : emptyTree(BT_PRESETS[k].max));
  const [hist, setHist] = useState<{ t: BTree; log: string[]; label: string }[]>(() => [{ t: make(startIdx), log: [], label: 'start' }]);
  const [key, setKey] = useState('');
  const cur = hist[hist.length - 1];
  const doOp = (op: '+' | '-' | '?') => {
    const k = Number(key);
    if (!key.trim() || !Number.isInteger(k)) return;
    if (op === '?') {
      const r = search(cur.t, k);
      setHist([...hist, { t: cur.t, log: [...r.path, r.found ? `${k} found.` : `${k} not found.`], label: `search ${k}` }]);
    } else {
      const r = op === '+' ? btInsert(cur.t, k) : btRemove(cur.t, k);
      setHist([...hist, { t: r.tree, log: r.log, label: `${op === '+' ? 'insert' : 'delete'} ${k}` }]);
    }
    setKey('');
  };
  const inv = invariants(cur.t);
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>B+Tree simulator</strong>
        <select
          className="select"
          value={preset}
          aria-label="Starting tree"
          onChange={(e) => {
            const k = Number(e.target.value);
            setPreset(k);
            setHist([{ t: make(k), log: [], label: 'start' }]);
          }}
        >
          {BT_PRESETS.map((b, k) => (
            <option key={k} value={k}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      <TreeView t={cur.t} />
      <div className="row gap wrap">
        <input className="input xs" inputMode="numeric" placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doOp('+')} aria-label="Key" />
        <button className="btn primary sm" onClick={() => doOp('+')}>
          Insert
        </button>
        <button className="btn ghost sm" onClick={() => doOp('-')}>
          Delete
        </button>
        <button className="btn ghost sm" onClick={() => doOp('?')}>
          Search
        </button>
        <button className="btn ghost sm" disabled={hist.length < 2} onClick={() => setHist(hist.slice(0, -1))}>
          Undo
        </button>
      </div>
      {cur.log.length > 0 && (
        <div className="trace-explain">
          <div className="fb-label">{cur.label}</div>
          <ol>
            {cur.log.map((l, k) => (
              <li key={k}>
                <Md md={l} />
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className={`muted small ${inv.length ? 'err' : ''}`}>{inv.length ? `Invariant problems: ${inv.join('; ')}` : '✓ All invariants hold: balanced, sorted, every non-root node at least half full.'}</div>
    </div>
  );
}

/* ---------------- Bloom filter ---------------- */
export function BloomLab() {
  const [m, setM] = useState(8);
  const [bits, setBits] = useState<number[]>(() => Array(8).fill(0));
  const [ins] = useState(() => new Set<string>());
  const [word, setWord] = useState('');
  const [log, setLog] = useState<{ text: string; mark: number[] }[]>([]);
  const slide = () => {
    const b = Array(8).fill(0);
    ins.clear();
    let cur = b;
    const out: { text: string; mark: number[] }[] = [];
    for (const [kind, w, pos] of [['+', 'RZA', [6, 4]], ['+', 'GZA', [1, 3]], ['?', 'RZA', [6, 4]], ['?', 'Raekwon', [5, 3]], ['?', 'ODB', [3, 6]]] as const) {
      const st = bloomApply(cur, { kind, word: w, pos: [...pos] }, ins);
      cur = st.after;
      out.push({ text: st.explain, mark: [...pos] });
    }
    setM(8);
    setBits(cur);
    setLog(out);
  };
  const op = (kind: '+' | '?') => {
    if (!word.trim()) return;
    const pos = bloomPositions(word.trim(), m);
    const st = bloomApply(bits, { kind, word: word.trim(), pos }, ins);
    setBits(st.after);
    setLog([{ text: st.explain, mark: pos }, ...log].slice(0, 8));
    setWord('');
  };
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Bloom filter</strong>
        <label className="small">
          bits{' '}
          <select
            className="select"
            value={m}
            onChange={(e) => {
              const n = Number(e.target.value);
              setM(n);
              setBits(Array(n).fill(0));
              ins.clear();
              setLog([]);
            }}
          >
            {[8, 10, 16, 32].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="btn ghost sm" onClick={slide}>
          Replay Lecture 7 slide 5
        </button>
      </div>
      <BloomView s={bits} mark={log[0]?.mark} />
      <div className="row gap wrap">
        <input className="input sm" placeholder="word" value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && op('?')} aria-label="Word" />
        <button className="btn primary sm" onClick={() => op('+')}>
          Insert
        </button>
        <button className="btn ghost sm" onClick={() => op('?')}>
          Lookup
        </button>
      </div>
      <div className="trace-explain">
        {log.length === 0 && <span className="muted small">Two hash functions (FNV-1a with two seeds) choose the bits for your words.</span>}
        {log.map((l, k) => (
          <Md key={k} md={l.text} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- NSM / DSM / PAX explorer ---------------- */
const LX_COLS = ['id', 'name', 'city', 'amount'];
const LX_ROWS: (string | number)[][] = [
  [1, 'Ali', 'Tashkent', 120],
  [2, 'Bo', 'Seoul', 80],
  [3, 'Cy', 'Tashkent', 45],
  [4, 'Di', 'Busan', 300],
  [5, 'Ed', 'Seoul', 60],
  [6, 'Fa', 'Tashkent', 95],
  [7, 'Gu', 'Busan', 15],
  [8, 'Hu', 'Seoul', 210],
];
export const LX_QUERIES: LayoutQuery[] = [
  { id: 'point', label: 'OLTP point lookup', sql: 'SELECT * FROM orders WHERE id = 6', kind: 'point', cols: [0, 1, 2, 3], rows: [5] },
  { id: 'sum', label: 'OLAP: one column', sql: 'SELECT SUM(amount) FROM orders', kind: 'scan', cols: [3], rows: 'all' },
  { id: 'group', label: 'OLAP: two columns', sql: 'SELECT city, SUM(amount) FROM orders GROUP BY city', kind: 'scan', cols: [2, 3], rows: 'all' },
  { id: 'full', label: 'Read whole table', sql: 'SELECT * FROM orders', kind: 'scan', cols: [0, 1, 2, 3], rows: 'all' },
  { id: 'insert', label: 'OLTP insert', sql: "INSERT INTO orders VALUES (9, 'Io', 'Seoul', 70)", kind: 'insert', cols: [0, 1, 2, 3], rows: [] },
];

export function LayoutExplorer() {
  const [layout, setLayout] = useState<Layout>('NSM');
  const [qid, setQid] = useState('point');
  const q = LX_QUERIES.find((x) => x.id === qid)!;
  const acc = layoutAccess(layout, LX_ROWS.length, LX_COLS.length, q);
  const read = new Set(acc.units.flatMap((u) => u.cells.map(([r, c]) => `${r},${c}`)));
  const useful = new Set((q.rows === 'all' ? LX_ROWS.map((_, i) => i) : q.rows).flatMap((r) => q.cols.map((c) => `${r},${c}`)));
  const cell = (r: number, c: number) => (
    <span key={`${r},${c}`} className={`lx-cell ${read.has(`${r},${c}`) ? (useful.has(`${r},${c}`) ? 'use' : 'waste') : ''}`} title={`${LX_COLS[c]} of row ${r + 1}`}>
      {LX_ROWS[r][c]}
    </span>
  );
  const groups: { title: string; cells: [number, number][] }[] = [];
  if (layout === 'NSM') for (let pg = 0; pg < 4; pg++) groups.push({ title: `Page ${pg + 1}`, cells: [0, 1].flatMap((k) => LX_COLS.map((_, c) => [pg * 2 + k, c] as [number, number])) });
  if (layout === 'DSM') LX_COLS.forEach((name, c) => groups.push({ title: `Column page: ${name}`, cells: LX_ROWS.map((_, r) => [r, c] as [number, number]) }));
  if (layout === 'PAX') for (let g = 0; g < 2; g++) groups.push({ title: `Row group ${g + 1} (rows ${g * 4 + 1}–${g * 4 + 4})`, cells: LX_COLS.flatMap((_, c) => [0, 1, 2, 3].map((k) => [g * 4 + k, c] as [number, number])) });
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Storage layout explorer</strong>
        <div className="seg" role="tablist">
          {(['NSM', 'DSM', 'PAX'] as Layout[]).map((l) => (
            <button key={l} role="tab" aria-selected={layout === l} className={`seg-b ${layout === l ? 'on' : ''}`} onClick={() => setLayout(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="row gap wrap">
        {LX_QUERIES.map((x) => (
          <button key={x.id} className={`chip ${x.id === qid ? 'on' : ''}`} onClick={() => setQid(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <code className="lx-sql">{q.sql}</code>
      <div className={`lx-groups ${layout.toLowerCase()}`}>
        {groups.map((g) => (
          <div key={g.title} className={`lx-group ${acc.units.length && g.cells.some(([r, c]) => read.has(`${r},${c}`)) ? 'touched' : ''}`}>
            <div className="lx-gtitle">{g.title}</div>
            <div className={`lx-cells ${layout === 'PAX' ? 'pax' : layout === 'DSM' ? 'dsm' : 'nsm'}`}>
              {layout === 'PAX'
                ? LX_COLS.map((name, c) => (
                    <div key={name} className="lx-minipage">
                      <span className="lx-mp-h">{name}</span>
                      {g.cells.filter(([, cc]) => cc === c).map(([r, cc]) => cell(r, cc))}
                    </div>
                  ))
                : g.cells.map(([r, c]) => cell(r, c))}
            </div>
          </div>
        ))}
      </div>
      <div className="lx-legend small">
        <span className="lx-cell use">needed</span> read &amp; needed · <span className="lx-cell waste">wasted</span> read but not needed
      </div>
      <div className="lx-stats">
        {q.kind === 'insert' ? (
          <div>
            Writes: <strong>{acc.writes}</strong> page/chunk location(s)
          </div>
        ) : (
          <>
            <div>
              Blocks touched: <strong>{acc.units.length}</strong>
            </div>
            <div>
              Values read: <strong>{acc.cellsRead}</strong> (needed: {acc.cellsUseful}, wasted: {acc.cellsRead - acc.cellsUseful})
            </div>
          </>
        )}
      </div>
      <div className="trace-explain">
        <Md md={acc.note} />
      </div>
      <div className="muted small">Toy model: NSM pages hold 2 full rows; DSM pages hold one column (8 values); PAX row groups hold 4 rows split into column chunks. Real pages hold thousands of tuples, but the ratios behave the same way.</div>
    </div>
  );
}

/* ---------------- slotted page ---------------- */
export function SlottedLab() {
  const [page, setPage] = useState<SlottedPage>(() => {
    let pg = newPage(256, 16, 4);
    pg = slottedInsert(pg, 40, 'Tuple #1').page;
    pg = slottedInsert(pg, 56, 'Tuple #2').page;
    pg = slottedInsert(pg, 32, 'Tuple #3').page;
    return pg;
  });
  const [len, setLen] = useState(48);
  const [msg, setMsg] = useState('A 256-byte page: 16-byte header, 4-byte slot entries. The slot array grows forward; tuple data grows backward from the end.');
  const [n, setN] = useState(4);
  const W = (b: number) => `${(b / page.size) * 100}%`;
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Slotted page</strong>
      </div>
      <div className="slotted" aria-label="page layout">
        <div className="sp-seg sp-header" style={{ width: W(page.header) }}>
          hdr
        </div>
        <div className="sp-seg sp-slots" style={{ width: W(page.slots.length * page.slotBytes) }}>
          {page.slots.length ? `slots ${page.slots.length}` : ''}
        </div>
        <div className="sp-seg sp-free" style={{ width: W(contiguousFree(page)) }}>
          free {contiguousFree(page)} B
        </div>
        {[...page.slots.map((s, i) => ({ s, i }))]
          .filter((x) => x.s)
          .sort((a, b) => a.s!.off - b.s!.off)
          .reduce<{ el: JSX.Element[]; pos: number }>(
            (acc, { s, i }) => {
              if (s!.off > acc.pos) acc.el.push(<div key={`h${i}`} className="sp-seg sp-hole" style={{ width: W(s!.off - acc.pos) }} />);
              acc.el.push(
                <div key={i} className="sp-seg sp-tuple" style={{ width: W(s!.len) }} title={`${s!.label}: offset ${s!.off}, ${s!.len} B`}>
                  #{i + 1}
                </div>,
              );
              acc.pos = s!.off + s!.len;
              return acc;
            },
            { el: [], pos: page.freeEnd },
          ).el}
      </div>
      <div className="muted small">
        slot array ends at byte {slotArrayEnd(page)} · tuple data starts at byte {page.freeEnd} · fragmented holes: {fragmentedBytes(page)} B
      </div>
      <table className="mini">
        <thead>
          <tr>
            <th>slot</th>
            <th>record ID</th>
            <th>offset</th>
            <th>length</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {page.slots.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>(page 7, slot {i + 1})</td>
              <td>{s ? s.off : '—'}</td>
              <td>{s ? `${s.len} B` : 'empty'}</td>
              <td>
                {s && (
                  <button
                    className="btn link sm"
                    onClick={() => {
                      const r = slottedDelete(page, i);
                      setPage(r.page);
                      setMsg(r.msg);
                    }}
                  >
                    delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap wrap">
        <label className="small">
          tuple size{' '}
          <input className="input xs" type="number" min={8} max={200} value={len} onChange={(e) => setLen(Math.max(8, Math.min(200, Number(e.target.value) || 8)))} />
        </label>
        <button
          className="btn primary sm"
          onClick={() => {
            const r = slottedInsert(page, len, `Tuple #${n}`);
            setPage(r.page);
            setMsg(r.msg);
            if (r.slot !== null) setN(n + 1);
          }}
        >
          Insert tuple
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            const r = slottedCompact(page);
            setPage(r.page);
            setMsg(r.msg);
          }}
        >
          Compact
        </button>
      </div>
      <div className="trace-explain">
        <Md md={msg} />
      </div>
    </div>
  );
}

/* ---------------- compression ---------------- */
export function CompressionLab() {
  const [scheme, setScheme] = useState<'rle' | 'bitmap' | 'delta' | 'for' | 'dict' | 'bitpack'>('rle');
  const [input, setInput] = useState('Y Y Y N Y N Y Y');
  const vals = input.trim().split(/[\s,]+/).filter(Boolean);
  const nums = vals.map(Number);
  const allNum = vals.length > 0 && nums.every((x) => !Number.isNaN(x));
  const presets: Record<string, string> = { rle: 'Y Y Y N Y N Y Y', bitmap: 'Y Y Y N Y N Y Y', delta: '99.5 99.4 99.5 99.6 99.4', for: '1203 1205 1201 1210 1204', dict: 'Andrea Mr.Pickles Andy Jignesh Mr.Pickles', bitpack: '13 191 56 92 81 120 231 172' };
  let out: JSX.Element;
  if (scheme === 'rle') {
    const t = rle(vals);
    out = (
      <>
        <code>{t.map(([v, o, l]) => `(${v},${o},${l})`).join(' ')}</code>
        <div className="muted small">
          {vals.length} values → {t.length} triplets (value, start offset, run length). Sorting the column first creates longer runs.
        </div>
      </>
    );
  } else if (scheme === 'bitmap') {
    const b = bitmapEncode(vals);
    out = (
      <>
        {b.map((x) => (
          <div key={x.value}>
            <code>
              {x.value}: {x.bits.join('')}
            </code>
          </div>
        ))}
        <div className="muted small">
          {b.length} distinct values × {vals.length} bits = {b.length * vals.length} bits (+ the value dictionary). Only practical when cardinality is low.
        </div>
      </>
    );
  } else if (scheme === 'delta' || scheme === 'for') {
    if (!allNum) out = <Err e="Enter numbers." />;
    else if (scheme === 'delta') {
      const d = deltaEncode(nums);
      out = (
        <>
          <code>
            base {d.base}, deltas {d.deltas.map((x) => (x > 0 ? `+${x}` : x)).join(' ')}
          </code>
          <div className="muted small">Small deltas need fewer bits than the full values; long runs of equal deltas compress further with RLE.</div>
        </>
      );
    } else {
      const f = frameOfReference(nums);
      out = (
        <>
          <code>
            min {f.base}, offsets {f.offsets.join(' ')}
          </code>
          <div className="muted small">Frame of reference stores each value relative to the global minimum: offsets fit in {bitsNeeded(Math.max(...f.offsets))} bits.</div>
        </>
      );
    }
  } else if (scheme === 'dict') {
    const d = dictionaryEncode(vals);
    out = (
      <>
        <code>codes: {d.codes.join(' ')}</code>
        <div className="muted small">Sorted dictionary: {d.dict.map((x) => `${x.value}=${x.code}`).join(', ')}. Order-preserving codes let range predicates (e.g. LIKE 'And%' → BETWEEN 10 AND 20) run on codes.</div>
      </>
    );
  } else {
    if (!allNum) out = <Err e="Enter non-negative integers." />;
    else {
      const b = bitsNeeded(Math.max(...nums));
      out = (
        <>
          <code>
            {b} bits per value: {vals.length} × {b} = {vals.length * b} bits instead of {vals.length} × 32 = {vals.length * 32} bits
          </code>
          <div className="muted small">Bits needed = ⌈log₂(max + 1)⌉. One outlier can ruin this — that is what “mostly” encoding fixes.</div>
        </>
      );
    }
  }
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Columnar compression</strong>
        <select
          className="select"
          value={scheme}
          aria-label="Scheme"
          onChange={(e) => {
            const s = e.target.value as typeof scheme;
            setScheme(s);
            setInput(presets[s]);
          }}
        >
          <option value="rle">Run-length encoding</option>
          <option value="bitmap">Bitmap encoding</option>
          <option value="delta">Delta encoding</option>
          <option value="for">Frame of reference</option>
          <option value="dict">Dictionary (order-preserving)</option>
          <option value="bitpack">Bit packing</option>
        </select>
      </div>
      <input className="input code-font" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Column values" />
      <div className="trace-explain">{out}</div>
    </div>
  );
}

/* ---------------- word alignment ---------------- */
export function AlignLab() {
  const [spec, setSpec] = useState('id:32 cdate:64 color:16 zipcode:32');
  const attrs = spec
    .trim()
    .split(/\s+/)
    .map((t) => t.split(':'))
    .filter((x) => x.length === 2 && Number(x[1]) > 0)
    .map(([name, b]) => ({ name, bits: Math.min(64, Number(b)) }));
  const pad = alignWithPadding(attrs);
  const re = alignWithReordering(attrs);
  const raw = attrs.reduce((a, x) => a + x.bits, 0);
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>Word alignment (64-bit words)</strong>
      </div>
      <input className="input code-font" value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="attributes name:bits" />
      <div className="align-row">
        {pad.cells.map((c, i) => (
          <span key={i} className={`al-cell ${c.pad ? 'pad' : ''}`} style={{ flexGrow: c.bits }} title={`${c.name} ${c.bits} bits`}>
            {c.pad ? `pad ${c.bits}` : `${c.name} ${c.bits}`}
          </span>
        ))}
      </div>
      <div className="muted small">
        Data: {raw} bits. Padding (declared order): {pad.words} words = {pad.words * 64} bits, {pad.padBits} bits of padding. Reordering ({re.order.join(', ')}): {re.words} words, {re.padBits} bits of padding.
      </div>
    </div>
  );
}

/* ---------------- LSM compaction ---------------- */
export function LsmLab() {
  const newer: LsmRec[] = [
    { op: 'DEL', key: 'key100' },
    { op: 'PUT', key: 'key101', val: 'a3' },
    { op: 'PUT', key: 'key102', val: 'b2' },
    { op: 'PUT', key: 'key103', val: 'c1' },
  ];
  const older: LsmRec[] = [
    { op: 'PUT', key: 'key101', val: 'a2' },
    { op: 'PUT', key: 'key102', val: 'b1' },
    { op: 'DEL', key: 'key103' },
    { op: 'PUT', key: 'key104', val: 'd2' },
  ];
  const [show, setShow] = useState(false);
  const merged = lsmCompact(newer, older);
  return (
    <div className="lab">
      <div className="lab-head">
        <strong>LSM compaction — Lecture 3, slide 35</strong>
      </div>
      <div className="lsm">
        <div className="sst">
          <div className="fb-label">Newer SSTable</div>
          {newer.map((r) => (
            <code key={r.key}>{lsmText(r)}</code>
          ))}
        </div>
        <div className="sst">
          <div className="fb-label">Older SSTable</div>
          {older.map((r) => (
            <code key={r.key}>{lsmText(r)}</code>
          ))}
        </div>
        <div className="sst out">
          <div className="fb-label">Compacted</div>
          {show ? merged.map((r) => <code key={r.key}>{lsmText(r)}</code>) : <span className="muted small">Predict the merged SSTable first.</span>}
        </div>
      </div>
      <button className="btn primary sm" onClick={() => setShow(!show)}>
        {show ? 'Hide' : 'Reveal'} the compacted SSTable
      </button>
      {show && <div className="muted small">Sort-merge by key and keep only the newest record for each key. key103’s newest record is PUT c1, so the older DEL is discarded; the DEL for key100 is kept so older levels stay hidden.</div>}
    </div>
  );
}
