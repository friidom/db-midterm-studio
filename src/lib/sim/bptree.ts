// B+Tree insert/delete with step logs (Lecture 6, slides 12–19).
// Occupancy rules match the lecture's examples: a non-root leaf needs ≥ ⌈max/2⌉ keys,
// a non-root inner node needs ≥ ⌈(max+1)/2⌉−1 keys; borrow/merge prefers the right sibling.

export interface BNode {
  leaf: boolean;
  keys: number[];
  kids: BNode[];
}

export interface BTree {
  root: BNode;
  maxKeys: number;
}

export const minLeaf = (max: number) => Math.ceil(max / 2);
export const minInner = (max: number) => Math.ceil((max + 1) / 2) - 1;

const cloneNode = (n: BNode): BNode => ({ leaf: n.leaf, keys: [...n.keys], kids: n.kids.map(cloneNode) });
export const cloneTree = (t: BTree): BTree => ({ root: cloneNode(t.root), maxKeys: t.maxKeys });

export const emptyTree = (maxKeys: number): BTree => ({ root: { leaf: true, keys: [], kids: [] }, maxKeys });

/** "[13] ([5 9] ([1 3] [5 7] [9 11]) [17 21] ([13 15] [17 19 20] [21 23]))" */
export function parseTree(spec: string, maxKeys: number): BTree {
  const toks = spec.match(/\[|\]|\(|\)|-?\d+/g) ?? [];
  let i = 0;
  const node = (): BNode => {
    if (toks[i] !== '[') throw new Error('Tree spec: expected [');
    i++;
    const keys: number[] = [];
    while (toks[i] !== ']') keys.push(Number(toks[i++]));
    i++;
    if (toks[i] === '(') {
      i++;
      const kids: BNode[] = [];
      while (toks[i] !== ')') kids.push(node());
      i++;
      return { leaf: false, keys, kids };
    }
    return { leaf: true, keys, kids: [] };
  };
  const root = node();
  return { root, maxKeys };
}

export function treeToString(t: BTree): string {
  const s = (n: BNode): string => `[${n.keys.join(' ')}]` + (n.leaf ? '' : ` (${n.kids.map(s).join(' ')})`);
  return s(t.root);
}

export function levels(t: BTree): BNode[][] {
  const out: BNode[][] = [];
  let cur = [t.root];
  while (cur.length) {
    out.push(cur);
    cur = cur.flatMap((n) => n.kids);
  }
  return out;
}

export const height = (t: BTree) => levels(t).length;

/** Child index for a key: separators route keys ≥ sep to the right. */
export const route = (n: BNode, key: number) => {
  let i = 0;
  while (i < n.keys.length && key >= n.keys[i]) i++;
  return i;
};

export function search(t: BTree, key: number): { path: string[]; found: boolean } {
  const path: string[] = [];
  let n = t.root;
  while (!n.leaf) {
    const i = route(n, key);
    path.push(`[${n.keys.join(' ')}] → child ${i}`);
    n = n.kids[i];
  }
  path.push(`leaf [${n.keys.join(' ')}]`);
  return { path, found: n.keys.includes(key) };
}

const fmt = (ks: number[]) => `[${ks.join(' ')}]`;

export function insert(t0: BTree, key: number): { tree: BTree; log: string[] } {
  const t = cloneTree(t0);
  const max = t.maxKeys;
  const log: string[] = [];
  const rec = (n: BNode): null | { sep: number; right: BNode } => {
    if (n.leaf) {
      if (n.keys.includes(key)) {
        log.push(`${key} is already in leaf ${fmt(n.keys)} — unique index, nothing to do.`);
        return null;
      }
      n.keys.push(key);
      n.keys.sort((a, b) => a - b);
      if (n.keys.length <= max) {
        log.push(`Insert ${key} into leaf → ${fmt(n.keys)} (fits: ≤ ${max} keys).`);
        return null;
      }
      const cut = Math.ceil(n.keys.length / 2);
      const right = { leaf: true, keys: n.keys.slice(cut), kids: [] as BNode[] };
      n.keys = n.keys.slice(0, cut);
      log.push(
        `Leaf would hold ${cut + right.keys.length} keys (> ${max}) → split into ${fmt(n.keys)} and ${fmt(right.keys)}; COPY UP ${right.keys[0]} (it stays in the leaf too).`,
      );
      return { sep: right.keys[0], right };
    }
    const i = route(n, key);
    log.push(`At inner node ${fmt(n.keys)}: ${key} goes to child ${i}.`);
    const res = rec(n.kids[i]);
    if (!res) return null;
    n.keys.splice(i, 0, res.sep);
    n.kids.splice(i + 1, 0, res.right);
    if (n.keys.length <= max) {
      log.push(`Add separator ${res.sep} to the parent → ${fmt(n.keys)}.`);
      return null;
    }
    const mid = Math.floor(n.keys.length / 2);
    const sep = n.keys[mid];
    const right: BNode = { leaf: false, keys: n.keys.slice(mid + 1), kids: n.kids.slice(mid + 1) };
    log.push(
      `Inner node ${fmt(n.keys)} overflows (> ${max} keys) → split into ${fmt(n.keys.slice(0, mid))} and ${fmt(right.keys)}; PUSH UP ${sep} (it moves up and is removed from both halves).`,
    );
    n.keys = n.keys.slice(0, mid);
    n.kids = n.kids.slice(0, mid + 1);
    return { sep, right };
  };
  const res = rec(t.root);
  if (res) {
    t.root = { leaf: false, keys: [res.sep], kids: [t.root, res.right] };
    log.push(`The root split → new root ${fmt([res.sep])}. The tree grows one level taller (height ${height(t)}).`);
  }
  return { tree: t, log };
}

export function remove(t0: BTree, key: number): { tree: BTree; log: string[]; found: boolean } {
  const t = cloneTree(t0);
  const max = t.maxKeys;
  const log: string[] = [];
  const fix = (p: BNode, i: number) => {
    const c = p.kids[i];
    const L = p.kids[i - 1];
    const R = p.kids[i + 1];
    if (c.leaf) {
      const min = minLeaf(max);
      if (R && R.keys.length > min) {
        c.keys.push(R.keys.shift() as number);
        p.keys[i] = R.keys[0];
        log.push(`Leaf is under-full (< ${min} keys). Right sibling has a spare key → borrow it: ${fmt(c.keys)} | ${fmt(R.keys)}; update parent separator to ${R.keys[0]}.`);
      } else if (L && L.keys.length > min) {
        c.keys.unshift(L.keys.pop() as number);
        p.keys[i - 1] = c.keys[0];
        log.push(`Leaf is under-full (< ${min} keys). Left sibling has a spare key → borrow it: ${fmt(L.keys)} | ${fmt(c.keys)}; update parent separator to ${c.keys[0]}.`);
      } else if (R) {
        const sep = p.keys[i];
        c.keys.push(...R.keys);
        p.keys.splice(i, 1);
        p.kids.splice(i + 1, 1);
        log.push(`Leaf is under-full and no sibling can lend (each has only ${min}) → MERGE with the right sibling: ${fmt(c.keys)}; delete separator ${sep} from the parent.`);
      } else {
        const sep = p.keys[i - 1];
        L.keys.push(...c.keys);
        p.keys.splice(i - 1, 1);
        p.kids.splice(i, 1);
        log.push(`Leaf is under-full and no sibling can lend → MERGE into the left sibling: ${fmt(L.keys)}; delete separator ${sep} from the parent.`);
      }
      return;
    }
    const min = minInner(max);
    if (R && R.keys.length > min) {
      c.keys.push(p.keys[i]);
      p.keys[i] = R.keys.shift() as number;
      c.kids.push(R.kids.shift() as BNode);
      log.push(`Inner node is under-full. Rotate through the parent from the right sibling: parent separator moves down, ${p.keys[i]} moves up.`);
    } else if (L && L.keys.length > min) {
      c.keys.unshift(p.keys[i - 1]);
      p.keys[i - 1] = L.keys.pop() as number;
      c.kids.unshift(L.kids.pop() as BNode);
      log.push(`Inner node is under-full. Rotate through the parent from the left sibling: parent separator moves down, ${p.keys[i - 1]} moves up.`);
    } else if (R) {
      const sep = p.keys[i];
      c.keys.push(sep, ...R.keys);
      c.kids.push(...R.kids);
      p.keys.splice(i, 1);
      p.kids.splice(i + 1, 1);
      log.push(`Inner node is under-full and its sibling cannot lend → PULL DOWN separator ${sep} and merge with the right sibling: ${fmt(c.keys)}.`);
    } else {
      const sep = p.keys[i - 1];
      L.keys.push(sep, ...c.keys);
      L.kids.push(...c.kids);
      p.keys.splice(i - 1, 1);
      p.kids.splice(i, 1);
      log.push(`Inner node ${fmt(c.keys)} is under-full and its sibling cannot lend → PULL DOWN separator ${sep} and merge into the left sibling: ${fmt(L.keys)}.`);
    }
  };
  const rec = (n: BNode): boolean => {
    if (n.leaf) {
      const j = n.keys.indexOf(key);
      if (j < 0) {
        log.push(`${key} is not in leaf ${fmt(n.keys)} → nothing to delete.`);
        return false;
      }
      n.keys.splice(j, 1);
      log.push(`Remove ${key} from the leaf → ${fmt(n.keys)}.`);
      return true;
    }
    const i = route(n, key);
    if (!rec(n.kids[i])) return false;
    const c = n.kids[i];
    const min = c.leaf ? minLeaf(max) : minInner(max);
    if (c.keys.length < min) fix(n, i);
    return true;
  };
  const found = rec(t.root);
  if (!t.root.leaf && t.root.keys.length === 0) {
    t.root = t.root.kids[0];
    log.push(`The root has no keys left → its only child becomes the new root. The tree shrinks in height (now ${height(t)}).`);
  }
  if (found && log.length === 1) log.push('The leaf is still at least half-full → done.');
  return { tree: t, log, found };
}

/** Check structural invariants — used by tests and the simulator's "invariants" panel. */
export function invariants(t: BTree): string[] {
  const errs: string[] = [];
  const depths = new Set<number>();
  const walk = (n: BNode, lo: number, hi: number, d: number, isRoot: boolean) => {
    const sorted = n.keys.every((k, i) => i === 0 || n.keys[i - 1] < k);
    if (!sorted) errs.push(`Keys not sorted in ${fmt(n.keys)}`);
    if (n.keys.length > t.maxKeys) errs.push(`Node ${fmt(n.keys)} has more than ${t.maxKeys} keys`);
    if (!isRoot) {
      const min = n.leaf ? minLeaf(t.maxKeys) : minInner(t.maxKeys);
      if (n.keys.length < min) errs.push(`Node ${fmt(n.keys)} is under-full (< ${min})`);
    }
    for (const k of n.keys) if (k < lo || k >= hi) errs.push(`Key ${k} out of range [${lo}, ${hi})`);
    if (n.leaf) depths.add(d);
    else {
      if (n.kids.length !== n.keys.length + 1) errs.push(`Inner node ${fmt(n.keys)} has ${n.kids.length} children`);
      n.kids.forEach((c, i) => walk(c, i === 0 ? lo : n.keys[i - 1], i === n.keys.length ? hi : n.keys[i], d + 1, false));
    }
  };
  walk(t.root, -Infinity, Infinity, 0, true);
  if (depths.size > 1) errs.push('Leaves are not all at the same depth');
  return errs;
}

export function parseBTOps(s: string): { op: '+' | '-' | '?'; key: number }[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([+?-])(\d+)$/.exec(tok);
      if (!m) throw new Error(`Bad operation “${tok}” — use +16 or -19`);
      return { op: m[1] as '+' | '-' | '?', key: Number(m[2]) };
    });
}
