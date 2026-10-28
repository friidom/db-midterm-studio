// Hash table schemes from Lecture 5: linear probing, cuckoo, extendible, linear hashing.

/* ---------------- Linear probe hashing (slides 13–17) ---------------- */

export type PSlot = { key: string } | 'empty' | 'tomb';
export interface ProbeOp {
  kind: '+' | '?' | '-';
  key: string;
  h: number; // home slot = hash(key) % N, given explicitly
}

/** "+A:2 +B:0 ?C:2 -C:2" — insert/lookup/delete with the key's home slot. */
export function parseProbeOps(s: string): ProbeOp[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([+?-])([^:]+):(\d+)$/.exec(tok);
      if (!m) throw new Error(`Bad operation “${tok}” — use +KEY:slot, ?KEY:slot or -KEY:slot`);
      return { kind: m[1] as ProbeOp['kind'], key: m[2], h: Number(m[3]) };
    });
}

export interface ProbeStep {
  op: ProbeOp;
  probes: number[];
  slot: number | null;
  result: 'inserted' | 'found' | 'not found' | 'deleted' | 'full';
  before: PSlot[];
  after: PSlot[];
  explain: string;
}

const slotName = (x: PSlot) => (x === 'empty' ? 'empty' : x === 'tomb' ? 'tombstone' : x.key);

export function probeApply(table: PSlot[], op: ProbeOp): ProbeStep {
  const n = table.length;
  const before = table.slice();
  const after = table.slice();
  const probes: number[] = [];
  const verb = op.kind === '+' ? 'Insert' : op.kind === '?' ? 'Lookup' : 'Delete';
  const parts = [`${verb} ${op.key}: hash(${op.key}) % ${n} = ${op.h}.`];
  for (let i = 0; i < n; i++) {
    const j = (op.h + i) % n;
    probes.push(j);
    const x = after[j];
    if (op.kind === '+') {
      if (x === 'empty' || x === 'tomb') {
        after[j] = { key: op.key };
        parts.push(i === 0 ? `Slot ${j} is ${slotName(x)} → store ${op.key} there.` : `Slot ${j} is ${slotName(x)} → store ${op.key} there.`);
        return { op, probes, slot: j, result: 'inserted', before, after, explain: parts.join(' ') };
      }
      parts.push(`Slot ${j} holds ${x.key} → collision, try the next slot.`);
    } else {
      if (x === 'empty') {
        parts.push(`Slot ${j} is empty → stop: ${op.key} is not in the table.`);
        return { op, probes, slot: null, result: 'not found', before, after, explain: parts.join(' ') };
      }
      if (x === 'tomb') {
        parts.push(`Slot ${j} is a tombstone → keep scanning (a deleted key used to be here).`);
        continue;
      }
      if (x.key === op.key) {
        if (op.kind === '-') {
          after[j] = 'tomb';
          parts.push(`Slot ${j} holds ${op.key} → replace it with a tombstone.`);
          return { op, probes, slot: j, result: 'deleted', before, after, explain: parts.join(' ') };
        }
        parts.push(`Slot ${j} holds ${op.key} → found.`);
        return { op, probes, slot: j, result: 'found', before, after, explain: parts.join(' ') };
      }
      parts.push(`Slot ${j} holds ${x.key} ≠ ${op.key} → keep scanning.`);
    }
  }
  parts.push(op.kind === '+' ? 'Every slot is occupied → the table is full and must be resized (×2) and rehashed.' : 'Scanned the whole table → not found.');
  return { op, probes, slot: null, result: op.kind === '+' ? 'full' : 'not found', before, after, explain: parts.join(' ') };
}

export function runProbe(size: number, ops: ProbeOp[]): ProbeStep[] {
  let t: PSlot[] = Array.from({ length: size }, () => 'empty' as const);
  return ops.map((op) => {
    const st = probeApply(t, op);
    t = st.after;
    return st;
  });
}

/* ---------------- Cuckoo hashing (slides 20–21): one table, two hash functions ---------------- */

export interface CuckooStep {
  key: string;
  h1: number;
  h2: number;
  before: (string | null)[];
  after: (string | null)[];
  moves: string[];
  ok: boolean;
}

export function cuckooInsert(
  table: (string | null)[],
  key: string,
  hashes: Record<string, [number, number]>,
  maxKicks = 10,
): CuckooStep {
  const before = table.slice();
  const t = table.slice();
  const [h1, h2] = hashes[key];
  const moves: string[] = [];
  if (t[h1] === null) {
    t[h1] = key;
    moves.push(`hash1(${key}) = ${h1} is empty → place ${key} in slot ${h1}.`);
    return { key, h1, h2, before, after: t, moves, ok: true };
  }
  if (t[h2] === null) {
    t[h2] = key;
    moves.push(`hash1(${key}) = ${h1} is taken by ${t[h1]}; hash2(${key}) = ${h2} is empty → place ${key} in slot ${h2}.`);
    return { key, h1, h2, before, after: t, moves, ok: true };
  }
  moves.push(`Both hash1(${key}) = ${h1} (${t[h1]}) and hash2(${key}) = ${h2} (${t[h2]}) are taken → evict ${t[h2]} from slot ${h2} and put ${key} there.`);
  let cur = t[h2] as string;
  let from = h2;
  t[h2] = key;
  for (let k = 0; k < maxKicks; k++) {
    const [a, b] = hashes[cur];
    const alt = from === a ? b : a;
    if (t[alt] === null) {
      t[alt] = cur;
      moves.push(`${cur} moves to its other slot ${alt}, which is empty → done.`);
      return { key, h1, h2, before, after: t, moves, ok: true };
    }
    moves.push(`${cur} moves to its other slot ${alt}, evicting ${t[alt]}.`);
    const next = t[alt] as string;
    t[alt] = cur;
    cur = next;
    from = alt;
  }
  moves.push('Too many evictions (a cycle) → rebuild the table with new hash functions / a bigger table.');
  return { key, h1, h2, before, after: t, moves, ok: false };
}

/* ---------------- Extendible hashing (slides 25–26) — directory indexed by the leading bits ---------------- */

export interface EHEntry {
  k: string;
  h: string; // binary hash string, e.g. "10111"
}
export interface EHBucket {
  local: number;
  keys: EHEntry[];
}
export interface EHState {
  global: number;
  dir: number[]; // directory slot → bucket index
  buckets: EHBucket[];
  cap: number;
}

export const ehIndex = (h: string, global: number) => (global === 0 ? 0 : parseInt(h.slice(0, global), 2));
export const bits = (i: number, n: number) => (n === 0 ? '' : i.toString(2).padStart(n, '0'));

export function ehCreate(cap: number, global: number, buckets: { local: number; keys: EHEntry[] }[], dir: number[]): EHState {
  return { cap, global, buckets: buckets.map((b) => ({ local: b.local, keys: [...b.keys] })), dir: [...dir] };
}

/** The lecture's starting state: global 2; {00010,01110} local 1; {10101,10011} local 2; {11010} local 2. */
export function ehFromSpec(spec: string, cap: number, global: number): EHState {
  // spec: "1:A=00010,B=01110 | 2:C=10101,D=10011 | 2:E=11010"
  const buckets = spec.split('|').map((part) => {
    const [loc, list] = part.trim().split(':');
    return {
      local: Number(loc),
      keys: (list ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [k, h] = x.split('=');
          return { k, h };
        }),
    };
  });
  // Buckets are listed in prefix order; a bucket with local depth L covers 2^(global−L) consecutive slots.
  const dir: number[] = [];
  buckets.forEach((bk, b) => {
    for (let j = 0; j < 2 ** (global - bk.local); j++) dir.push(b);
  });
  if (dir.length !== 2 ** global) throw new Error('Extendible hashing spec: local depths do not cover the directory');
  return ehCreate(cap, global, buckets, dir);
}

export interface EHStep {
  key: string;
  h: string;
  slot: number; // directory slot used for the final insert
  bucket: number;
  doubled: number; // how many directory doublings happened
  splits: number;
  before: EHState;
  after: EHState;
  explain: string[];
}

export function ehInsert(prev: EHState, key: string, h: string): EHStep {
  const s = ehCreate(prev.cap, prev.global, prev.buckets, prev.dir);
  const explain: string[] = [];
  let doubled = 0,
    splits = 0;
  let slot = ehIndex(h, s.global);
  let b = s.dir[slot];
  explain.push(`hash(${key}) = ${h}… → first ${s.global} bit${s.global === 1 ? '' : 's'} “${bits(slot, s.global)}” → directory slot ${slot} → bucket with local depth ${s.buckets[b].local}.`);
  while (s.buckets[b].keys.length >= s.cap) {
    const L = s.buckets[b].local;
    if (L >= h.length) {
      explain.push('All hash bits are used — cannot split further (would need an overflow chain).');
      break;
    }
    explain.push(`That bucket is full (${s.cap} entries) → overflow, so split it.`);
    if (L === s.global) {
      s.dir = s.dir.flatMap((x) => [x, x]);
      s.global++;
      doubled++;
      explain.push(`Its local depth (${L}) equals the global depth → double the directory: global depth ${s.global - 1} → ${s.global} (${s.dir.length} slots; each old slot is copied).`);
    }
    const nb = s.buckets.length;
    const old = s.buckets[b].keys;
    s.buckets[b] = { local: L + 1, keys: old.filter((e) => e.h[L] === '0') };
    s.buckets.push({ local: L + 1, keys: old.filter((e) => e.h[L] === '1') });
    for (let i = 0; i < s.dir.length; i++) if (s.dir[i] === b && ((i >> (s.global - 1 - L)) & 1) === 1) s.dir[i] = nb;
    splits++;
    explain.push(
      `Split on bit ${L + 1}: keys with a 0 there stay (${s.buckets[b].keys.map((e) => e.h).join(', ') || 'none'}), keys with a 1 move to a new bucket (${s.buckets[nb].keys.map((e) => e.h).join(', ') || 'none'}). Both now have local depth ${L + 1}; only the directory slots for the split bucket change.`,
    );
    slot = ehIndex(h, s.global);
    b = s.dir[slot];
  }
  s.buckets[b].keys.push({ k: key, h });
  explain.push(`Insert ${key} into the bucket for slot ${bits(slot, s.global)}.`);
  return { key, h, slot, bucket: b, doubled, splits, before: prev, after: s, explain };
}

/* ---------------- Linear hashing (slides 27–30) ---------------- */

export interface LHState {
  n0: number; // initial number of buckets
  level: number;
  next: number; // split pointer
  cap: number; // primary page capacity (overflow pages beyond it)
  buckets: number[][];
}

export const lhSize = (s: LHState) => s.n0 * 2 ** s.level;

export function lhBucket(s: LHState, key: number): { b: number; note: string } {
  const n = lhSize(s);
  const b1 = key % n;
  if (b1 >= s.next) return { b: b1, note: `hash1(${key}) = ${key} % ${n} = ${b1}${s.next ? ` ≥ split pointer ${s.next}` : ''} → bucket ${b1}` };
  const b2 = key % (2 * n);
  return { b: b2, note: `hash1(${key}) = ${key} % ${n} = ${b1} < split pointer ${s.next} (already split) → use hash2(${key}) = ${key} % ${2 * n} = ${b2}` };
}

const lhClone = (s: LHState): LHState => ({ ...s, buckets: s.buckets.map((b) => [...b]) });

export interface LHStep {
  op: '+' | '?' | '-';
  key: number;
  bucket: number;
  overflow: boolean;
  split: null | { from: number; to: number; moved: number[] };
  found?: boolean;
  before: LHState;
  after: LHState;
  explain: string[];
}

export function lhApply(prev: LHState, op: '+' | '?' | '-', key: number): LHStep {
  const s = lhClone(prev);
  const { b, note } = lhBucket(s, key);
  const explain = [note + '.'];
  if (op === '?') {
    const found = s.buckets[b].includes(key);
    explain.push(found ? `${key} is in bucket ${b} → found.` : `${key} is not in bucket ${b} → not found.`);
    return { op, key, bucket: b, overflow: false, split: null, found, before: prev, after: s, explain };
  }
  if (op === '-') {
    const i = s.buckets[b].indexOf(key);
    if (i < 0) {
      explain.push(`${key} is not in bucket ${b} → nothing to delete.`);
      return { op, key, bucket: b, overflow: false, split: null, found: false, before: prev, after: s, explain };
    }
    s.buckets[b].splice(i, 1);
    explain.push(`Remove ${key} from bucket ${b}.`);
    const last = s.buckets.length - 1;
    if (b === last && s.buckets[b].length === 0 && last >= s.n0) {
      s.buckets.pop();
      if (s.next > 0) s.next--;
      else {
        s.level--;
        s.next = lhSize(s) - 1;
      }
      explain.push(`Bucket ${b} (the highest bucket, created by the last split) is now empty → remove it and move the split pointer back to ${s.next}.`);
    }
    return { op, key, bucket: b, overflow: false, split: null, found: true, before: prev, after: s, explain };
  }
  s.buckets[b].push(key);
  const overflow = s.buckets[b].length > s.cap;
  if (!overflow) {
    explain.push(`Bucket ${b} has room → insert ${key}.`);
    return { op, key, bucket: b, overflow, split: null, before: prev, after: s, explain };
  }
  explain.push(`Bucket ${b} is full → ${key} goes to an overflow page. Any overflow triggers a split of the bucket at the split pointer (bucket ${s.next}), not necessarily bucket ${b}.`);
  const n = lhSize(s);
  const from = s.next;
  const to = from + n;
  const old = s.buckets[from];
  s.buckets[from] = old.filter((k) => k % (2 * n) === from);
  s.buckets[to] = old.filter((k) => k % (2 * n) === to);
  const moved = s.buckets[to].slice();
  explain.push(
    `Split bucket ${from}: rehash its keys with hash2(key) = key % ${2 * n}. ${moved.length ? `${moved.join(', ')} move${moved.length === 1 ? 's' : ''} to new bucket ${to}` : `Nothing moves; new bucket ${to} starts empty`}.`,
  );
  s.next++;
  if (s.next === n) {
    s.level++;
    s.next = 0;
    explain.push(`The split pointer reached the end of the round → every bucket has split; hash2 becomes the new hash1 (key % ${2 * n}) and the pointer resets to 0.`);
  } else explain.push(`Split pointer → ${s.next}.`);
  return { op, key, bucket: b, overflow, split: { from, to, moved }, before: prev, after: s, explain };
}

/* ---------------- Bloom filter (Lecture 7, slides 4–5) ---------------- */

/** FNV-1a 32-bit — deterministic stand-in for the k hash functions on custom words. */
export function fnv1a(s: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const bloomPositions = (word: string, m: number, k = 2) => Array.from({ length: k }, (_, i) => fnv1a(word, i * 0x9e3779b1) % m);

export interface BloomOp {
  kind: '+' | '?';
  word: string;
  pos: number[];
}

/** "+RZA:6,4 ?ODB:3,6" — explicit bit positions, or "+word" to compute them with FNV-1a. */
export function parseBloomOps(s: string, m: number, k = 2): BloomOp[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const mm = /^([+?])([^:]+)(?::([\d,]+))?$/.exec(tok);
      if (!mm) throw new Error(`Bad operation “${tok}” — use +word or ?word`);
      const pos = mm[3] ? mm[3].split(',').map(Number) : bloomPositions(mm[2], m, k);
      return { kind: mm[1] as '+' | '?', word: mm[2], pos };
    });
}

export interface BloomStep {
  op: BloomOp;
  before: number[];
  after: number[];
  result?: boolean;
  explain: string;
}

export function bloomApply(bits: number[], op: BloomOp, inserted: Set<string>): BloomStep {
  const after = bits.slice();
  if (op.kind === '+') {
    for (const p of op.pos) after[p] = 1;
    inserted.add(op.word);
    return { op, before: bits, after, explain: `Insert '${op.word}': set bits ${op.pos.join(' and ')} to 1.` };
  }
  const result = op.pos.every((p) => bits[p] === 1);
  const zero = op.pos.find((p) => bits[p] === 0);
  const explain = result
    ? inserted.has(op.word)
      ? `Lookup '${op.word}': bits ${op.pos.join(', ')} are all 1 → TRUE (it was inserted).`
      : `Lookup '${op.word}': bits ${op.pos.join(', ')} are all 1 → TRUE, but '${op.word}' was never inserted — a FALSE POSITIVE (other keys set those bits).`
    : `Lookup '${op.word}': bit ${zero} is 0 → FALSE. A 0 bit proves the key was never inserted (no false negatives).`;
  return { op, before: bits, after, result, explain };
}

export function parseLHOps(s: string): { op: '+' | '?' | '-'; key: number }[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([+?-])(\d+)$/.exec(tok);
      if (!m) throw new Error(`Bad operation “${tok}” — use +17, ?6 or -20`);
      return { op: m[1] as '+' | '?' | '-', key: Number(m[2]) };
    });
}
