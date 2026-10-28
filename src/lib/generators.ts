// Seeded question generators: unlimited trace practice whose answers come from the tested simulators.
import type { Question } from './types';
import { rng, randInt, shuffle, pick, type Rand } from './random';
import { simulateBuffer, parseRefs, bufSummary, type Policy } from './sim/buffer';
import { runProbe, parseProbeOps } from './sim/hashing';
import { insert as btInsert, emptyTree } from './sim/bptree';
import { rle } from './sim/storage';
import { runRA } from './ra';

export type GenKind = 'buf-trace' | 'buf-evict' | 'buf-misses' | 'probe-trace' | 'linhash-trace' | 'exthash-trace' | 'bptree-trace' | 'bptree-root' | 'bloom-trace' | 'rle' | 'ra-count';

export const GEN_INFO: Record<GenKind, { module: string; label: string; skills: string[] }> = {
  'buf-trace': { module: 'm5', label: 'Buffer pool trace (step by step)', skills: ['bp-policy', 'bp-dirty'] },
  'buf-evict': { module: 'm5', label: 'Eviction order', skills: ['bp-policy'] },
  'buf-misses': { module: 'm5', label: 'Count the misses', skills: ['bp-policy'] },
  'probe-trace': { module: 'm6', label: 'Linear probing with tombstones', skills: ['ht-probe'] },
  'linhash-trace': { module: 'm6', label: 'Linear hashing trace', skills: ['ht-linear'] },
  'exthash-trace': { module: 'm6', label: 'Extendible hashing trace', skills: ['ht-extendible'] },
  'bptree-trace': { module: 'm7', label: 'B+Tree insert trace', skills: ['bt-insert'] },
  'bptree-root': { module: 'm7', label: 'B+Tree root after inserts', skills: ['bt-insert'] },
  'bloom-trace': { module: 'm8', label: 'Bloom filter trace', skills: ['ix-bloom'] },
  rle: { module: 'm4', label: 'Run-length encoding', skills: ['cmp-columnar'] },
  'ra-count': { module: 'm1', label: 'Relational algebra result size', skills: ['ra-join', 'ra-setops'] },
};

const POLICIES: Policy[] = ['LRU', 'CLOCK', 'MRU', 'LRU2'];
const POLICY_TEXT: Record<Policy, string> = {
  LRU: 'LRU',
  CLOCK: 'CLOCK (new pages start with ref = 0, as drawn on Lecture 4 slide 61; a hit sets ref = 1; the hand starts at frame 0)',
  MRU: 'MRU (evict the most recently used page)',
  LRU2: 'LRU-K with K = 2 (evict the largest backward 2-distance; pages with fewer than 2 accesses count as +∞, ties → earliest first access)',
};

function refString(r: Rand, n: number, pages: number, writes = true): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = randInt(r, 1, pages);
    out.push(`${writes && r() < 0.25 ? 'W' : 'R'}${p}`);
  }
  return out.join(' ');
}

const letters = 'ABCDEFGHJKMNPQ'.split('');

export function generate(kind: GenKind, seed: number): Question {
  const r = rng(seed);
  const info = GEN_INFO[kind];
  const id = `g:${kind}:${seed}`;
  const base = { id, module: info.module, skills: info.skills, generated: true, source: 'Generated practice (answers computed by the simulator)' };
  switch (kind) {
    case 'buf-trace': {
      const policy = pick(r, POLICIES);
      const refs = refString(r, 9, 5);
      return {
        ...base,
        type: 'trace',
        level: 2,
        trace: { sim: 'buffer', policy, frames: 3, refs, newRef: 0 },
        prompt: `A buffer pool has **3 frames** (initially empty) and uses **${POLICY_TEXT[policy]}**. Predict each request of \`${refs}\` (R = read, W = write).`,
        explain: 'Follow the policy rule at every miss. Only dirty pages (written while in memory) need a write-back when they are evicted.',
        hints: ['A request is a HIT only if the page is already in one of the frames.', 'No eviction happens while a frame is still free.'],
      };
    }
    case 'buf-evict':
    case 'buf-misses': {
      const policy = pick(r, ['LRU', 'CLOCK', 'MRU'] as Policy[]);
      let refs = refString(r, 9, 5, false);
      let steps = simulateBuffer(policy, 3, parseRefs(refs), { newRef: 0 });
      for (let guard = 0; guard < 20 && bufSummary(steps).evicted.length < 2; guard++) {
        refs = refString(r, 9, 5, false);
        steps = simulateBuffer(policy, 3, parseRefs(refs), { newRef: 0 });
      }
      const sum = bufSummary(steps);
      if (kind === 'buf-misses')
        return {
          ...base,
          type: 'num',
          level: 2,
          answer: sum.misses,
          prompt: `3 empty frames, policy **${POLICY_TEXT[policy]}**. Reference string: \`${refs.replace(/R/g, '')}\`. How many **misses** occur (count the first loads too)?`,
          explain: `Trace: ${steps.map((s) => `${s.ref.page}:${s.hit ? 'hit' : s.victim !== null ? `miss (evict ${s.victim})` : 'miss'}`).join(', ')} → ${sum.misses} misses, ${sum.hits} hits.`,
          hints: ['The first time each page is requested is always a miss.', 'Write the frame contents after every request.'],
        };
      return {
        ...base,
        type: 'text',
        mode: 'list',
        level: 2,
        answer: [sum.evicted.join(' ')],
        placeholder: 'e.g. 3 1 4',
        prompt: `3 empty frames, policy **${POLICY_TEXT[policy]}**. Reference string: \`${refs.replace(/R/g, '')}\`. List the **evicted pages in order** (space-separated).`,
        explain: `Trace: ${steps.map((s) => `${s.ref.page}:${s.hit ? 'hit' : s.victim !== null ? `miss→evict ${s.victim}` : 'miss'}`).join(', ')}. Evicted: ${sum.evicted.join(', ')}.`,
        hints: ['Evictions start only once all 3 frames are full.', policy === 'MRU' ? 'MRU evicts the page used most recently before this request.' : 'Track the order of last use (LRU) or the reference bits (CLOCK).'],
      };
    }
    case 'probe-trace': {
      const n = 7;
      const keys = shuffle(r, letters).slice(0, 5);
      const ops: string[] = keys.map((k) => `+${k}:${randInt(r, 0, n - 1)}`);
      const victim = pick(r, keys.slice(0, 4));
      const vh = ops.find((o) => o.startsWith(`+${victim}:`))!.split(':')[1];
      const later = keys[4];
      const lh = ops[4].split(':')[1];
      ops.splice(4, 0, `-${victim}:${vh}`);
      ops.push(`?${later}:${lh}`);
      runProbe(n, parseProbeOps(ops.join(' '))); // validates
      return {
        ...base,
        type: 'trace',
        level: 2,
        trace: { sim: 'probe', size: n, ops: ops.join(' ') },
        prompt: `Linear probe hashing, table of **${n} slots** (0–${n - 1}), deletes use **tombstones**. The number after each key is hash(key) % ${n}.`,
        explain: 'Insert scans forward from the home slot to the first empty slot or tombstone. Lookups skip tombstones and stop only at an empty slot.',
        hints: ['Wrap around from the last slot to slot 0.', 'A tombstone is NOT an empty slot for lookups.'],
      };
    }
    case 'linhash-trace': {
      const keys = shuffle(
        r,
        Array.from({ length: 20 }, (_, i) => i + 2),
      ).slice(0, 7);
      return {
        ...base,
        type: 'trace',
        level: 3,
        trace: { sim: 'linhash', n0: 2, cap: 2, ops: keys.map((k) => `+${k}`).join(' ') },
        prompt: 'Linear hashing: **2 buckets** initially, **2 keys per page**, hash1(key) = key % 2, split pointer at 0. Any overflow splits the bucket at the split pointer.',
        explain: 'Use hash1 unless the bucket it gives is below the split pointer; then use the next-level hash (key % 2n).',
        hints: ['The bucket that splits is the one at the split pointer, not necessarily the one that overflowed.'],
      };
    }
    case 'exthash-trace': {
      const hashes = shuffle(
        r,
        Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, '0')),
      ).slice(0, 5);
      return {
        ...base,
        type: 'trace',
        level: 3,
        trace: { sim: 'exthash', cap: 2, global: 1, start: '1: | 1:', ops: hashes.map((h, i) => `+${letters[i]}=${h}`).join(' ') },
        prompt: 'Extendible hashing using the **leading bits** of 4-bit hashes, **bucket capacity 2**, starting with global depth 1 and two empty buckets (local depth 1).',
        explain: 'Look up the directory with the first *global-depth* bits. On overflow, split the bucket; double the directory only when local depth = global depth.',
        hints: ['Splitting a bucket whose local depth is smaller than the global depth does not change the directory size.'],
      };
    }
    case 'bptree-trace':
    case 'bptree-root': {
      const maxKeys = pick(r, [3, 4]);
      const keys = shuffle(
        r,
        Array.from({ length: 30 }, (_, i) => i + 1),
      ).slice(0, maxKeys === 3 ? 7 : 9);
      if (kind === 'bptree-trace')
        return {
          ...base,
          type: 'trace',
          level: 3,
          trace: { sim: 'bptree', maxKeys, ops: keys.map((k) => `+${k}`).join(' ') },
          prompt: `Insert into an empty B+Tree whose nodes hold at most **${maxKeys} keys**. Leaf split: left keeps ⌈n/2⌉ keys and the first key of the right leaf is **copied up**; inner split: the middle key is **pushed up**.`,
          explain: 'Leaf splits copy the separator up (it stays in the leaf); inner-node splits push it up (it leaves the node).',
          hints: ['A node overflows only when it would hold more than the maximum number of keys.'],
        };
      let t = emptyTree(maxKeys);
      for (const k of keys) t = btInsert(t, k).tree;
      return {
        ...base,
        type: 'text',
        mode: 'list',
        level: 3,
        answer: [t.root.keys.join(' ')],
        placeholder: 'e.g. 9 17',
        prompt: `Insert ${keys.join(', ')} (in this order) into an empty B+Tree with at most **${maxKeys} keys per node** (leaf split: left keeps ⌈n/2⌉, copy up; inner split: push up the middle key). What keys are in the **root** at the end?`,
        explain: `Final root: [${t.root.keys.join(' ')}]. Draw the tree after each split — the root only changes when a split propagates all the way up.`,
        hints: ['The first split happens when a leaf would hold more than the maximum.', 'Separators copied up from leaves are the first key of the new right leaf.'],
      };
    }
    case 'bloom-trace': {
      const words = shuffle(r, ['RZA', 'GZA', 'ODB', 'Raekwon', 'Ghostface', 'Method', 'Inspectah', 'Masta', 'Cappadonna', 'U-God']).slice(0, 5);
      return {
        ...base,
        type: 'trace',
        level: 2,
        trace: { sim: 'bloom', m: 10, ops: `+${words[0]} +${words[1]} +${words[2]} ?${words[0]} ?${words[3]} ?${words[4]}` },
        prompt: 'A Bloom filter with **10 bits** and **2 hash functions** (positions are shown for each key). Predict the bits and every lookup result.',
        explain: 'Insert sets every hashed bit. Lookup says TRUE only when every hashed bit is 1 — which can happen for keys never inserted (false positive), but a key that was inserted always answers TRUE.',
        hints: ['One 0 bit is enough to answer FALSE.'],
      };
    }
    case 'rle': {
      const vals = Array.from({ length: 9 }, () => (r() < 0.65 ? 'Y' : 'N'));
      const trip = rle(vals);
      return {
        ...base,
        type: 'text',
        mode: 'list',
        level: 1,
        answer: [trip.map(([v, o, l]) => `(${v},${o},${l})`).join(' ')],
        placeholder: '(Y,0,3) (N,3,1) …',
        prompt: `Run-length encode the column \`${vals.join(' ')}\` as (value, start offset, length) triplets, offsets starting at 0 (as on Lecture 4 slide 35).`,
        explain: `Each run of equal adjacent values becomes one triplet: ${trip.map(([v, o, l]) => `(${v},${o},${l})`).join(' ')}.`,
        hints: ['Offsets count positions in the column, starting from 0.'],
      };
    }
    case 'ra-count': {
      const mk = (name: string) => {
        const n = randInt(r, 3, 5);
        const rows: (string | number)[][] = [];
        for (let i = 0; i < n; i++) rows.push([pick(r, ['a1', 'a2', 'a3', 'a4']), pick(r, [101, 102, 103])]);
        return { name, cols: ['a_id', 'b_id'], rows };
      };
      const R = mk('R');
      const S = mk('S');
      const op = pick(r, ['R ⋈ S', 'R ∪ S', 'R ∩ S', 'R − S', 'π[a_id](R)', 'R × S']);
      const db = { R: { cols: R.cols, rows: R.rows }, S: { cols: S.cols, rows: S.rows } };
      const res = runRA(op, db);
      return {
        ...base,
        type: 'num',
        level: 2,
        answer: res.rel.rows.length,
        context: [
          {
            k: 'tables',
            ts: [
              { title: 'R(a_id, b_id)', cols: R.cols, rows: R.rows },
              { title: 'S(a_id, b_id)', cols: S.cols, rows: S.rows },
            ],
          },
        ],
        prompt: `Relational algebra uses **set semantics**. How many tuples does \`${op}\` return?`,
        explain: `${op} returns ${res.rel.rows.length} tuple(s): ${res.rel.rows.map((x) => `(${x.join(', ')})`).join(' ') || 'none'}. Remember that the inputs themselves are sets: duplicate tuples inside R or S count once.`,
        hints: ['First remove duplicate tuples inside R and S — relations are sets.'],
      };
    }
  }
}

/** Rebuild a generated question from its id (used by the review queue). */
export function fromGeneratedId(id: string): Question | null {
  const m = /^g:([a-z-]+):(\d+)$/.exec(id);
  if (!m || !(m[1] in GEN_INFO)) return null;
  return generate(m[1] as GenKind, Number(m[2]));
}

export function gensForModule(module: string): GenKind[] {
  return (Object.keys(GEN_INFO) as GenKind[]).filter((k) => GEN_INFO[k].module === module);
}
