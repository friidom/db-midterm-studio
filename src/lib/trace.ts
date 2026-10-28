// Turns a TraceSpec into prediction steps: the learner answers each "ask" before the step is revealed.
import type { TraceSpec } from './types';
import { listItems, normalizeText, parseNumber } from './answers';
import { parseRefs, simulateBuffer, refLabel, type BufState } from './sim/buffer';
import {
  parseProbeOps,
  runProbe,
  ehFromSpec,
  ehInsert,
  bits,
  type PSlot,
  type EHState,
  parseLHOps,
  lhApply,
  type LHState,
  parseBloomOps,
  bloomApply,
} from './sim/hashing';
import { parseTree, emptyTree, insert as btInsert, remove as btRemove, parseBTOps, type BTree } from './sim/bptree';

export interface Ask {
  key: string;
  label: string;
  kind: 'choice' | 'number' | 'text';
  options?: string[];
  answer: string;
  placeholder?: string;
}

export type SimState =
  | { sim: 'buffer'; s: BufState; policy: string }
  | { sim: 'probe'; s: PSlot[] }
  | { sim: 'exthash'; s: EHState }
  | { sim: 'linhash'; s: LHState }
  | { sim: 'bptree'; s: BTree }
  | { sim: 'bloom'; s: number[] };

export interface TraceStep {
  title: string;
  asks: Ask[];
  explain: string[];
  before: SimState;
  after: SimState;
}

const yn = (b: boolean) => (b ? 'Yes' : 'No');

export function buildTrace(spec: TraceSpec): TraceStep[] {
  switch (spec.sim) {
    case 'buffer': {
      const steps = simulateBuffer(spec.policy, spec.frames, parseRefs(spec.refs), { newRef: spec.newRef });
      return steps.map((st) => {
        const resident = st.before.frames.map((f) => f.page).filter((p): p is number => p !== null);
        return {
          title: `Request ${st.i + 1}: ${refLabel(st.ref)} (${st.ref.write ? 'write' : 'read'} page ${st.ref.page})`,
          asks: [
            { key: 'hit', label: 'Hit or miss?', kind: 'choice', options: ['HIT', 'MISS'], answer: st.hit ? 'HIT' : 'MISS' },
            {
              key: 'victim',
              label: 'Which page is evicted?',
              kind: 'choice',
              options: ['none', ...resident.map((p) => `page ${p}`)],
              answer: st.victim === null ? 'none' : `page ${st.victim}`,
            },
            { key: 'wb', label: 'Must a page be written back to disk first?', kind: 'choice', options: ['Yes', 'No'], answer: yn(st.victimDirty) },
          ],
          explain: st.explain,
          before: { sim: 'buffer', s: st.before, policy: spec.policy },
          after: { sim: 'buffer', s: st.after, policy: spec.policy },
        };
      });
    }
    case 'probe': {
      const steps = runProbe(spec.size, parseProbeOps(spec.ops));
      return steps.map((st) => {
        const { op } = st;
        const asks: Ask[] =
          op.kind === '+'
            ? [{ key: 'slot', label: `Which slot does ${op.key} end up in?`, kind: 'number', answer: String(st.slot ?? -1) }]
            : op.kind === '?'
              ? [
                  { key: 'res', label: `Is ${op.key} found?`, kind: 'choice', options: ['found', 'not found'], answer: st.result },
                  { key: 'probes', label: 'How many slots are examined?', kind: 'number', answer: String(st.probes.length) },
                ]
              : [{ key: 'slot', label: `Which slot gets the tombstone? (−1 if ${op.key} is not found)`, kind: 'number', answer: String(st.slot ?? -1) }];
        return {
          title: `${op.kind === '+' ? 'Insert' : op.kind === '?' ? 'Lookup' : 'Delete'} ${op.key} (home slot ${op.h})`,
          asks,
          explain: [st.explain],
          before: { sim: 'probe', s: st.before },
          after: { sim: 'probe', s: st.after },
        };
      });
    }
    case 'exthash': {
      let s = spec.start ? ehFromSpec(spec.start, spec.cap, spec.global) : ehFromSpec('0:', spec.cap, 0);
      return spec.ops
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const [k, h] = tok.replace(/^\+/, '').split('=');
          const st = ehInsert(s, k, h);
          s = st.after;
          return {
            title: `Insert ${k} with hash ${h}…`,
            asks: [
              { key: 'slot', label: `Which directory slot is used first (the first ${st.before.global} bits)?`, kind: 'text', answer: bits(parseInt(h.slice(0, st.before.global) || '0', 2), st.before.global) || '(none — global depth 0)', placeholder: 'e.g. 10' },
              { key: 'split', label: 'Does the insert cause a bucket split?', kind: 'choice', options: ['Yes', 'No'], answer: yn(st.splits > 0) },
              { key: 'global', label: 'Global depth after the insert?', kind: 'number', answer: String(st.after.global) },
            ],
            explain: st.explain,
            before: { sim: 'exthash', s: st.before },
            after: { sim: 'exthash', s: st.after },
          };
        });
    }
    case 'linhash': {
      let s: LHState = { n0: spec.n0, level: 0, next: 0, cap: spec.cap, buckets: spec.start ? spec.start.map((b) => [...b]) : Array.from({ length: spec.n0 }, () => []) };
      return parseLHOps(spec.ops).map(({ op, key }) => {
        const st = lhApply(s, op, key);
        s = st.after;
        const asks: Ask[] = [{ key: 'b', label: `Which bucket does ${key} map to?`, kind: 'number', answer: String(st.bucket) }];
        if (op === '+') {
          asks.push({ key: 'split', label: 'Does a split happen?', kind: 'choice', options: ['Yes', 'No'], answer: yn(!!st.split) });
          asks.push({ key: 'next', label: 'Split pointer after this operation?', kind: 'number', answer: String(st.after.next) });
        }
        return {
          title: `${op === '+' ? 'Insert' : op === '?' ? 'Lookup' : 'Delete'} ${key}`,
          asks,
          explain: st.explain,
          before: { sim: 'linhash', s: st.before },
          after: { sim: 'linhash', s: st.after },
        };
      });
    }
    case 'bptree': {
      let t = spec.start ? parseTree(spec.start, spec.maxKeys) : emptyTree(spec.maxKeys);
      return parseBTOps(spec.ops).map(({ op, key }) => {
        const before = t;
        const r = op === '-' ? btRemove(t, key) : btInsert(t, key);
        t = r.tree;
        const log = r.log.join(' ');
        const asks: Ask[] =
          op === '+'
            ? [{ key: 'split', label: 'Does any node split?', kind: 'choice', options: ['Yes', 'No'], answer: yn(/split/i.test(log)) }]
            : [
                {
                  key: 'what',
                  label: 'What does the deletion need?',
                  kind: 'choice',
                  options: ['Nothing (leaf still half-full)', 'Borrow from a sibling', 'Merge with a sibling'],
                  answer: /MERGE/.test(log) ? 'Merge with a sibling' : /borrow|Rotate/i.test(log) ? 'Borrow from a sibling' : 'Nothing (leaf still half-full)',
                },
              ];
        asks.push({ key: 'root', label: 'Keys in the root afterwards (space-separated)?', kind: 'text', answer: t.root.keys.join(' ') || '(empty)', placeholder: 'e.g. 9 13' });
        return {
          title: `${op === '-' ? 'Delete' : 'Insert'} ${key} (max ${spec.maxKeys} keys per node)`,
          asks,
          explain: r.log,
          before: { sim: 'bptree', s: before },
          after: { sim: 'bptree', s: t },
        };
      });
    }
    case 'bloom': {
      let bitsArr = Array.from({ length: spec.m }, () => 0);
      const inserted = new Set<string>();
      return parseBloomOps(spec.ops, spec.m).map((op) => {
        const st = bloomApply(bitsArr, op, inserted);
        bitsArr = st.after;
        const asks: Ask[] =
          op.kind === '+'
            ? [{ key: 'bits', label: `Which bits are 1 after inserting '${op.word}'? (all of them)`, kind: 'text', answer: st.after.map((b, i) => (b ? i : -1)).filter((i) => i >= 0).join(' '), placeholder: 'e.g. 1 3 4' }]
            : [
                {
                  key: 'res',
                  label: `Lookup '${op.word}' returns…`,
                  kind: 'choice',
                  options: ['TRUE (key present)', 'TRUE (false positive)', 'FALSE'],
                  answer: st.result ? (inserted.has(op.word) ? 'TRUE (key present)' : 'TRUE (false positive)') : 'FALSE',
                },
              ];
        return {
          title: `${op.kind === '+' ? 'Insert' : 'Lookup'} '${op.word}' → hash positions ${op.pos.join(', ')}`,
          asks,
          explain: [st.explain],
          before: { sim: 'bloom', s: st.before },
          after: { sim: 'bloom', s: st.after },
        };
      });
    }
  }
}

export function checkAsk(ask: Ask, value: string): boolean {
  if (ask.kind === 'number') {
    const n = parseNumber(value);
    return n !== null && n === Number(ask.answer);
  }
  if (ask.kind === 'text') return listItems(value).join(' ') === listItems(ask.answer).join(' ') || normalizeText(value) === normalizeText(ask.answer);
  return value === ask.answer;
}
