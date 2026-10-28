// Buffer pool replacement simulator (Lecture 4, slides 51–65).
export type Policy = 'LRU' | 'MRU' | 'CLOCK' | 'LRU2';

export const POLICY_LABEL: Record<Policy, string> = {
  LRU: 'LRU',
  MRU: 'MRU',
  CLOCK: 'CLOCK',
  LRU2: 'LRU-K (K=2)',
};

export interface Ref {
  page: number;
  write: boolean;
}

/** "R1 W2 3" → reads/writes; a bare number is a read. */
export function parseRefs(s: string): Ref[] {
  return s
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([RW]?)(\d+)$/i.exec(tok);
      if (!m) throw new Error(`Bad page reference “${tok}” — use forms like R3 or W3`);
      return { page: Number(m[2]), write: m[1].toUpperCase() === 'W' };
    });
}

export const refLabel = (r: Ref) => `${r.write ? 'W' : 'R'}${r.page}`;

export interface Frame {
  page: number | null;
  dirty: boolean;
  ref: 0 | 1;
}

export interface BufState {
  frames: Frame[];
  hand: number; // CLOCK hand: next frame to examine
  t: number; // logical time = number of requests served
  last: Record<number, number>; // page → last access time
  hist: Record<number, number[]>; // page → access times while resident (LRU-K)
}

export interface BufStep {
  i: number;
  ref: Ref;
  hit: boolean;
  frame: number;
  victim: number | null;
  victimDirty: boolean;
  before: BufState;
  after: BufState;
  explain: string[];
}

export function initBuf(n: number): BufState {
  return {
    frames: Array.from({ length: n }, () => ({ page: null, dirty: false, ref: 0 as const })),
    hand: 0,
    t: 0,
    last: {},
    hist: {},
  };
}

const clone = (s: BufState): BufState => ({
  frames: s.frames.map((f) => ({ ...f })),
  hand: s.hand,
  t: s.t,
  last: { ...s.last },
  hist: Object.fromEntries(Object.entries(s.hist).map(([k, v]) => [k, [...v]])),
});

const K = 2;

/** Backward K-distance at time t (Infinity when the page has fewer than K accesses). */
export function kDistance(s: BufState, page: number, t: number): number {
  const h = s.hist[page] ?? [];
  return h.length < K ? Infinity : t - h[h.length - K];
}

export interface BufOptions {
  /** Reference bit given to a page loaded on a miss. Lecture 4 slide 61 draws new pages with ref=0. */
  newRef?: 0 | 1;
}

export function bufStep(prev: BufState, ref: Ref, policy: Policy, i: number, opt: BufOptions = {}): BufStep {
  const s = clone(prev);
  const before = clone(prev);
  const t = s.t + 1;
  s.t = t;
  const explain: string[] = [];
  const at = s.frames.findIndex((f) => f.page === ref.page);
  const name = `page ${ref.page}`;

  if (at >= 0) {
    const f = s.frames[at];
    explain.push(`${name} is already in frame ${at} → HIT (no disk read).`);
    if (policy === 'CLOCK') {
      if (f.ref === 0) explain.push('Accessing it sets its reference bit to 1.');
      f.ref = 1;
    }
    if (policy === 'LRU') explain.push(`It becomes the most recently used page.`);
    if (ref.write) {
      explain.push(f.dirty ? 'The write keeps the page dirty.' : 'The write marks the page dirty (it now differs from the disk copy).');
      f.dirty = true;
    }
    s.last[ref.page] = t;
    (s.hist[ref.page] ??= []).push(t);
    return { i, ref, hit: true, frame: at, victim: null, victimDirty: false, before, after: s, explain };
  }

  explain.push(`${name} is not in the buffer pool → MISS (must read it from disk).`);
  let target = s.frames.findIndex((f) => f.page === null);
  let victim: number | null = null;
  let victimDirty = false;

  if (target >= 0) {
    explain.push(`Frame ${target} is free, so no eviction is needed.`);
  } else {
    const resident = s.frames.map((f) => f.page as number);
    if (policy === 'LRU' || policy === 'MRU') {
      const order = [...resident].sort((a, b) => s.last[a] - s.last[b]);
      victim = policy === 'LRU' ? order[0] : order[order.length - 1];
      explain.push(
        `No free frame. ${policy} evicts the page with the ${policy === 'LRU' ? 'oldest' : 'most recent'} last access: page ${victim} (last used at t=${s.last[victim]}; times: ${order
          .map((p) => `p${p}@${s.last[p]}`)
          .join(', ')}).`,
      );
    } else if (policy === 'CLOCK') {
      const n = s.frames.length;
      const sweep: string[] = [];
      for (let guard = 0; guard < 2 * n + 1; guard++) {
        const f = s.frames[s.hand];
        if (f.ref === 1) {
          sweep.push(`frame ${s.hand} (page ${f.page}): ref=1 → set to 0, move on`);
          f.ref = 0;
          s.hand = (s.hand + 1) % n;
        } else {
          sweep.push(`frame ${s.hand} (page ${f.page}): ref=0 → evict`);
          victim = f.page;
          break;
        }
      }
      explain.push(`No free frame. The clock hand sweeps: ${sweep.join('; ')}.`);
    } else {
      const d = resident.map((p) => ({ p, d: kDistance(s, p, t), first: (s.hist[p] ?? [Infinity])[0] }));
      d.sort((a, b) => (b.d === a.d ? a.first - b.first : b.d - a.d));
      victim = d[0].p;
      explain.push(
        `No free frame. Backward 2-distance (now t=${t}): ${d
          .map((x) => `p${x.p}=${x.d === Infinity ? '+∞' : x.d}`)
          .join(', ')}. Evict the largest${d.filter((x) => x.d === Infinity).length > 1 ? ' (ties at +∞ → the page with the earliest recorded access)' : ''}: page ${victim}.`,
      );
    }
    target = s.frames.findIndex((f) => f.page === victim);
    victimDirty = s.frames[target].dirty;
    explain.push(
      victimDirty
        ? `Page ${victim} is dirty, so it must be written back to disk before frame ${target} is reused (slow path).`
        : `Page ${victim} is clean, so it is simply dropped (fast path).`,
    );
    delete s.last[victim as number];
    delete s.hist[victim as number];
  }

  const newRef = opt.newRef ?? 0;
  s.frames[target] = { page: ref.page, dirty: ref.write, ref: policy === 'CLOCK' ? newRef : 0 };
  s.last[ref.page] = t;
  s.hist[ref.page] = [t];
  if (policy === 'CLOCK' && victim !== null) s.hand = (target + 1) % s.frames.length;
  explain.push(
    `Load ${name} into frame ${target}${policy === 'CLOCK' ? ` with ref=${newRef}` : ''}${ref.write ? ' and mark it dirty (write)' : ''}.` +
      (policy === 'CLOCK' && victim !== null ? ` The hand moves on to frame ${s.hand}.` : ''),
  );
  return { i, ref, hit: false, frame: target, victim, victimDirty, before, after: s, explain };
}

export function simulateBuffer(policy: Policy, frames: number, refs: Ref[], opt: BufOptions = {}): BufStep[] {
  let s = initBuf(frames);
  return refs.map((r, i) => {
    const st = bufStep(s, r, policy, i, opt);
    s = st.after;
    return st;
  });
}

export function bufSummary(steps: BufStep[]) {
  return {
    hits: steps.filter((s) => s.hit).length,
    misses: steps.filter((s) => !s.hit).length,
    evicted: steps.filter((s) => s.victim !== null).map((s) => s.victim as number),
    writes: steps.filter((s) => s.victimDirty).length,
  };
}
