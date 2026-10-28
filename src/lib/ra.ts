// Relational algebra parser + evaluator (Lecture 1, slides 34–43). Set semantics: every result is de-duplicated.
export type Val = string | number | null;
export interface Col {
  name: string;
  rel?: string;
}
export interface Rel {
  cols: Col[];
  rows: Val[][];
}
export type RelDb = Record<string, { cols: string[]; rows: Val[][] }>;

type Scalar =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'null' }
  | { t: 'attr'; name: string; rel?: string }
  | { t: 'arith'; op: '+' | '-' | '*' | '/'; l: Scalar; r: Scalar };
type Cond =
  | { t: 'cmp'; op: string; l: Scalar; r: Scalar }
  | { t: 'and' | 'or'; l: Cond; r: Cond }
  | { t: 'not'; c: Cond };
interface ProjItem {
  s: Scalar;
  as?: string;
  text: string;
}
export type Expr =
  | { t: 'rel'; name: string }
  | { t: 'select'; cond: Cond; e: Expr }
  | { t: 'project'; items: ProjItem[]; e: Expr }
  | { t: 'rename'; name: string; cols?: string[]; e: Expr }
  | { t: 'distinct'; e: Expr }
  | { t: 'bin'; op: 'union' | 'intersect' | 'diff' | 'product' | 'natjoin' | 'theta'; l: Expr; r: Expr; cond?: Cond };

export class RAError extends Error {}

/* ---------------- tokenizer ---------------- */
interface Tok {
  k: 'id' | 'num' | 'str' | 'op';
  v: string;
  p: number;
}

const KW: Record<string, string> = {
  select: 'σ', sigma: 'σ', project: 'π', pi: 'π', rename: 'ρ', rho: 'ρ', distinct: 'δ', delta: 'δ',
  union: '∪', intersect: '∩', minus: '−', except: '−', diff: '−', difference: '−',
  cross: '×', times: '×', product: '×', join: '⋈', natjoin: '⋈', and: '∧', or: '∨', not: '¬',
};

function tokenize(src: string): Tok[] {
  const s = src.replace(/_\s*[{[]/g, '[').replace(/[{]/g, '[').replace(/[}]/g, ']').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
      const w = s.slice(i, j);
      const kw = KW[w.toLowerCase()];
      if (kw) out.push({ k: 'op', v: kw, p: i });
      else if (w.toLowerCase() === 'as') out.push({ k: 'op', v: 'as', p: i });
      else if (w.toLowerCase() === 'null') out.push({ k: 'op', v: 'null', p: i });
      else out.push({ k: 'id', v: w, p: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ k: 'num', v: s.slice(i, j), p: i });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const j = s.indexOf(c, i + 1);
      if (j < 0) throw new RAError(`Unclosed string starting at position ${i + 1}`);
      out.push({ k: 'str', v: s.slice(i + 1, j), p: i });
      i = j + 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '!=', '<>'].includes(two)) {
      out.push({ k: 'op', v: two === '<>' ? '!=' : two, p: i });
      i += 2;
      continue;
    }
    const map: Record<string, string> = { '≠': '!=', '≤': '<=', '≥': '>=', '-': '−', '–': '−', '—': '−', '⨝': '⋈', '∖': '−', '\\': '−' };
    const v = map[c] ?? c;
    if ('σπρδ∪∩−×⋈∧∨¬()[],=<>+*/'.includes(v) || v === '!=' || v === '<=' || v === '>=') {
      out.push({ k: 'op', v, p: i });
      i++;
      continue;
    }
    throw new RAError(`Unexpected character “${c}” at position ${i + 1}`);
  }
  return out;
}

/* ---------------- parser ---------------- */
export function parseRA(src: string): Expr {
  const toks = tokenize(src);
  let i = 0;
  const peek = (o = 0) => toks[i + o];
  const isOp = (v: string, o = 0) => peek(o)?.k === 'op' && peek(o)?.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new RAError(`Expected “${v}”${peek() ? ` near “${peek().v}” (position ${peek().p + 1})` : ' at the end'}`);
    i++;
  };
  const srcText = (from: number, to: number) => {
    const a = toks[from].p;
    const b = to < toks.length ? toks[to].p : src.length;
    return src.slice(a, b).replace(/\s+/g, '').trim();
  };

  const atom = (): Scalar => {
    const t = peek();
    if (!t) throw new RAError('Unexpected end of expression');
    if (t.k === 'num') {
      i++;
      return { t: 'num', v: Number(t.v) };
    }
    if (t.k === 'str') {
      i++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'op' && t.v === 'null') {
      i++;
      return { t: 'null' };
    }
    if (t.k === 'id') {
      i++;
      const dot = t.v.lastIndexOf('.');
      return dot > 0 ? { t: 'attr', rel: t.v.slice(0, dot), name: t.v.slice(dot + 1) } : { t: 'attr', name: t.v };
    }
    if (isOp('(')) {
      i++;
      const e = arith();
      expect(')');
      return e;
    }
    if (isOp('−')) {
      i++;
      const a = atom();
      if (a.t === 'num') return { t: 'num', v: -a.v };
      return { t: 'arith', op: '-', l: { t: 'num', v: 0 }, r: a };
    }
    throw new RAError(`Unexpected “${t.v}” (position ${t.p + 1})`);
  };
  const term = (): Scalar => {
    let l = atom();
    while (isOp('*') || isOp('/')) {
      const op = peek().v as '*' | '/';
      i++;
      l = { t: 'arith', op, l, r: atom() };
    }
    return l;
  };
  const arith = (): Scalar => {
    let l = term();
    while (isOp('+') || isOp('−')) {
      const op = peek().v === '+' ? '+' : '-';
      i++;
      l = { t: 'arith', op, l, r: term() };
    }
    return l;
  };
  const CMP = ['=', '!=', '<', '<=', '>', '>='];
  const cmp = (): Cond => {
    const l = arith();
    const t = peek();
    if (!t || t.k !== 'op' || !CMP.includes(t.v)) throw new RAError(`Expected a comparison (=, ≠, <, ≤, >, ≥)${t ? ` near “${t.v}”` : ''}`);
    i++;
    return { t: 'cmp', op: t.v, l, r: arith() };
  };
  const notC = (): Cond => {
    if (isOp('¬')) {
      i++;
      return { t: 'not', c: notC() };
    }
    if (isOp('(')) {
      const save = i;
      try {
        return cmp();
      } catch {
        i = save + 1;
        const c = orC();
        expect(')');
        return c;
      }
    }
    return cmp();
  };
  const andC = (): Cond => {
    let l = notC();
    while (isOp('∧')) {
      i++;
      l = { t: 'and', l, r: notC() };
    }
    return l;
  };
  const orC = (): Cond => {
    let l = andC();
    while (isOp('∨')) {
      i++;
      l = { t: 'or', l, r: andC() };
    }
    return l;
  };
  const bracketCond = () => {
    expect('[');
    const c = orC();
    expect(']');
    return c;
  };

  const unary = (): Expr => {
    const t = peek();
    if (!t) throw new RAError('Unexpected end of expression');
    if (isOp('σ')) {
      i++;
      const cond = bracketCond();
      return { t: 'select', cond, e: unary() };
    }
    if (isOp('π')) {
      i++;
      expect('[');
      const items: ProjItem[] = [];
      do {
        if (isOp(',')) i++;
        const from = i;
        const s = arith();
        const text = srcText(from, i);
        let as: string | undefined;
        if (isOp('as')) {
          i++;
          const n = peek();
          if (!n || n.k !== 'id') throw new RAError('Expected a name after “as”');
          as = n.v;
          i++;
        }
        items.push({ s, as, text });
      } while (isOp(','));
      expect(']');
      return { t: 'project', items, e: unary() };
    }
    if (isOp('ρ')) {
      i++;
      expect('[');
      const n = peek();
      if (!n || n.k !== 'id') throw new RAError('ρ needs a new relation name, e.g. ρ[T](R) or ρ[T(x,y)](R)');
      i++;
      let cols: string[] | undefined;
      if (isOp('(')) {
        i++;
        cols = [];
        while (!isOp(')')) {
          const c = peek();
          if (!c || c.k !== 'id') throw new RAError('Expected attribute names inside ρ[T(…)]');
          cols.push(c.v);
          i++;
          if (isOp(',')) i++;
        }
        i++;
      }
      expect(']');
      return { t: 'rename', name: n.v, cols, e: unary() };
    }
    if (isOp('δ')) {
      i++;
      return { t: 'distinct', e: unary() };
    }
    if (isOp('(')) {
      i++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.k === 'id') {
      i++;
      return { t: 'rel', name: t.v };
    }
    throw new RAError(`Unexpected “${t.v}” (position ${t.p + 1})`);
  };
  const join = (): Expr => {
    let l = unary();
    while (isOp('⋈') || isOp('×')) {
      if (isOp('×')) {
        i++;
        l = { t: 'bin', op: 'product', l, r: unary() };
      } else {
        i++;
        if (isOp('[')) {
          const cond = bracketCond();
          l = { t: 'bin', op: 'theta', l, r: unary(), cond };
        } else l = { t: 'bin', op: 'natjoin', l, r: unary() };
      }
    }
    return l;
  };
  const expr = (): Expr => {
    let l = join();
    while (isOp('∪') || isOp('∩') || isOp('−')) {
      const v = peek().v;
      i++;
      l = { t: 'bin', op: v === '∪' ? 'union' : v === '∩' ? 'intersect' : 'diff', l, r: join() };
    }
    return l;
  };
  if (!toks.length) throw new RAError('Type a relational algebra expression');
  const e = expr();
  if (i < toks.length) throw new RAError(`Unexpected “${peek().v}” at position ${peek().p + 1}`);
  return e;
}

/* ---------------- printing ---------------- */
const sStr = (s: Scalar): string =>
  s.t === 'num' ? String(s.v) : s.t === 'str' ? `'${s.v}'` : s.t === 'null' ? 'NULL' : s.t === 'attr' ? (s.rel ? `${s.rel}.${s.name}` : s.name) : `${sStr(s.l)}${s.op}${sStr(s.r)}`;
const OPS: Record<string, string> = { '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };
const cStr = (c: Cond): string =>
  c.t === 'cmp' ? `${sStr(c.l)}${OPS[c.op]}${sStr(c.r)}` : c.t === 'not' ? `¬(${cStr(c.c)})` : `${cStr(c.l)} ${c.t === 'and' ? '∧' : '∨'} ${cStr(c.r)}`;
const wrap = (e: Expr) => (e.t === 'bin' ? `(${exprStr(e)})` : exprStr(e));
export function exprStr(e: Expr): string {
  switch (e.t) {
    case 'rel':
      return e.name;
    case 'select':
      return `σ[${cStr(e.cond)}](${exprStr(e.e)})`;
    case 'project':
      return `π[${e.items.map((x) => x.text + (x.as ? ` as ${x.as}` : '')).join(', ')}](${exprStr(e.e)})`;
    case 'rename':
      return `ρ[${e.name}${e.cols ? `(${e.cols.join(',')})` : ''}](${exprStr(e.e)})`;
    case 'distinct':
      return `δ(${exprStr(e.e)})`;
    case 'bin': {
      const sym = { union: '∪', intersect: '∩', diff: '−', product: '×', natjoin: '⋈', theta: `⋈[${e.cond ? cStr(e.cond) : ''}]` }[e.op];
      return `${wrap(e.l)} ${sym} ${wrap(e.r)}`;
    }
  }
}

/* ---------------- evaluation ---------------- */
export interface RANode {
  op: string;
  label: string;
  explain: string;
  rel: Rel;
  kids: RANode[];
}

const key = (r: Val[]) => JSON.stringify(r);
export function dedup(rows: Val[][]): Val[][] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function colLabels(rel: Rel): string[] {
  return rel.cols.map((c) => (rel.cols.filter((d) => d.name === c.name).length > 1 && c.rel ? `${c.rel}.${c.name}` : c.name));
}

function resolve(cols: Col[], a: { name: string; rel?: string }): number {
  const hits = cols.map((c, i) => ({ c, i })).filter(({ c }) => c.name.toLowerCase() === a.name.toLowerCase() && (!a.rel || c.rel?.toLowerCase() === a.rel.toLowerCase()));
  if (!hits.length) throw new RAError(`Unknown attribute “${a.rel ? a.rel + '.' : ''}${a.name}”. Available: ${cols.map((c) => (c.rel ? `${c.rel}.${c.name}` : c.name)).join(', ')}`);
  if (hits.length > 1) throw new RAError(`Attribute “${a.name}” is ambiguous — qualify it, e.g. ${hits.map((h) => `${h.c.rel}.${a.name}`).join(' or ')}`);
  return hits[0].i;
}

function scalar(s: Scalar, cols: Col[], row: Val[]): Val {
  switch (s.t) {
    case 'num':
      return s.v;
    case 'str':
      return s.v;
    case 'null':
      return null;
    case 'attr':
      return row[resolve(cols, s)];
    case 'arith': {
      const l = scalar(s.l, cols, row);
      const r = scalar(s.r, cols, row);
      if (l === null || r === null) return null;
      const a = Number(l);
      const b = Number(r);
      if (Number.isNaN(a) || Number.isNaN(b)) throw new RAError(`Arithmetic on non-numbers: ${l} ${s.op} ${r}`);
      return s.op === '+' ? a + b : s.op === '-' ? a - b : s.op === '*' ? a * b : a / b;
    }
  }
}

function compare(a: Val, b: Val): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== typeof b && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Three-valued logic: comparisons with NULL are UNKNOWN (null); σ keeps only TRUE. */
function cond(c: Cond, cols: Col[], row: Val[]): boolean | null {
  if (c.t === 'cmp') {
    const l = scalar(c.l, cols, row);
    const r = scalar(c.r, cols, row);
    if (l === null || r === null) return null;
    const d = compare(l, r);
    return { '=': d === 0, '!=': d !== 0, '<': d < 0, '<=': d <= 0, '>': d > 0, '>=': d >= 0 }[c.op] as boolean;
  }
  if (c.t === 'not') {
    const v = cond(c.c, cols, row);
    return v === null ? null : !v;
  }
  const l = cond(c.l, cols, row);
  const r = cond(c.r, cols, row);
  if (c.t === 'and') return l === false || r === false ? false : l === null || r === null ? null : true;
  return l === true || r === true ? true : l === null || r === null ? null : false;
}

function compatible(l: Rel, r: Rel, what: string): Rel {
  const ln = l.cols.map((c) => c.name.toLowerCase());
  const rn = r.cols.map((c) => c.name.toLowerCase());
  if (ln.length !== rn.length || [...ln].sort().join() !== [...rn].sort().join())
    throw new RAError(`${what} needs union-compatible inputs (same attributes). Left has (${ln.join(', ')}), right has (${rn.join(', ')}).`);
  const perm = ln.map((n) => rn.indexOf(n));
  return { cols: l.cols, rows: r.rows.map((row) => perm.map((j) => row[j])) };
}

export function evalRA(e: Expr, db: RelDb): RANode {
  const node = (op: string, rel: Rel, kids: RANode[], explain: string): RANode => ({ op, label: exprStr(e), explain, rel: { cols: rel.cols, rows: dedup(rel.rows) }, kids });
  switch (e.t) {
    case 'rel': {
      const name = Object.keys(db).find((k) => k === e.name) ?? Object.keys(db).find((k) => k.toLowerCase() === e.name.toLowerCase());
      if (!name) throw new RAError(`Unknown relation “${e.name}”. Available: ${Object.keys(db).join(', ')}`);
      const t = db[name];
      return node('relation', { cols: t.cols.map((c) => ({ name: c, rel: name })), rows: t.rows }, [], `Base relation ${name}.`);
    }
    case 'select': {
      const k = evalRA(e.e, db);
      const rows = k.rel.rows.filter((r) => cond(e.cond, k.rel.cols, r) === true);
      return node('σ', { cols: k.rel.cols, rows }, [k], `Keep the ${rows.length} of ${k.rel.rows.length} tuples where ${cStr(e.cond)} is TRUE.`);
    }
    case 'project': {
      const k = evalRA(e.e, db);
      const cols = e.items.map((it) => (it.s.t === 'attr' ? { name: it.as ?? it.s.name, rel: it.as ? undefined : k.rel.cols[resolve(k.rel.cols, it.s)].rel } : { name: it.as ?? it.text }));
      const raw = k.rel.rows.map((r) => e.items.map((it) => scalar(it.s, k.rel.cols, r)));
      const out = dedup(raw);
      return node(
        'π',
        { cols, rows: out },
        [k],
        `Keep only ${e.items.map((x) => x.text).join(', ')}.${raw.length > out.length ? ` ${raw.length - out.length} duplicate tuple(s) disappear (set semantics).` : ''}`,
      );
    }
    case 'rename': {
      const k = evalRA(e.e, db);
      if (e.cols && e.cols.length !== k.rel.cols.length) throw new RAError(`ρ[${e.name}(…)] lists ${e.cols.length} names but the input has ${k.rel.cols.length} attributes`);
      const cols = k.rel.cols.map((c, i) => ({ name: e.cols ? e.cols[i] : c.name, rel: e.name }));
      return node('ρ', { cols, rows: k.rel.rows }, [k], `Rename the relation to ${e.name}${e.cols ? ` and its attributes to (${e.cols.join(', ')})` : ''}. Tuples are unchanged.`);
    }
    case 'distinct': {
      const k = evalRA(e.e, db);
      return node('δ', k.rel, [k], 'Remove duplicates (relational algebra results are already sets, so nothing changes here).');
    }
    case 'bin': {
      const l = evalRA(e.l, db);
      const r = evalRA(e.r, db);
      const L = l.rel;
      const R = r.rel;
      if (e.op === 'union' || e.op === 'intersect' || e.op === 'diff') {
        const rr = compatible(L, R, { union: 'Union', intersect: 'Intersection', diff: 'Difference' }[e.op]);
        const rk = new Set(rr.rows.map(key));
        const lk = new Set(L.rows.map(key));
        const rows = e.op === 'union' ? [...L.rows, ...rr.rows] : e.op === 'intersect' ? L.rows.filter((x) => rk.has(key(x))) : L.rows.filter((x) => !rk.has(key(x)));
        const explain =
          e.op === 'union'
            ? `All tuples in either input; ${L.rows.length + rr.rows.length - dedup(rows).length} duplicate(s) removed.`
            : e.op === 'intersect'
              ? `Tuples that appear in both inputs (${rows.length}).`
              : `Tuples of the left input that are not in the right input (${rows.length} of ${L.rows.length}).`;
        void lk;
        return node(e.op === 'union' ? '∪' : e.op === 'intersect' ? '∩' : '−', { cols: L.cols, rows }, [l, r], explain);
      }
      const cols = [...L.cols, ...R.cols];
      const prod = L.rows.flatMap((a) => R.rows.map((b) => [...a, ...b]));
      if (e.op === 'product') return node('×', { cols, rows: prod }, [l, r], `Every tuple of the left paired with every tuple of the right: ${L.rows.length} × ${R.rows.length} = ${prod.length} tuples.`);
      if (e.op === 'theta') {
        const rows = prod.filter((x) => cond(e.cond as Cond, cols, x) === true);
        return node('⋈θ', { cols, rows }, [l, r], `Pair tuples and keep the ${rows.length} pair(s) where ${cStr(e.cond as Cond)} (= σ applied to the product).`);
      }
      const common = L.cols.map((c) => c.name.toLowerCase()).filter((n) => R.cols.some((d) => d.name.toLowerCase() === n));
      const li = common.map((n) => L.cols.findIndex((c) => c.name.toLowerCase() === n));
      const ri = common.map((n) => R.cols.findIndex((c) => c.name.toLowerCase() === n));
      const keepR = R.cols.map((_, j) => j).filter((j) => !ri.includes(j));
      const rows = L.rows.flatMap((a) => R.rows.filter((b) => li.every((x, k) => a[x] !== null && compare(a[x], b[ri[k]]) === 0)).map((b) => [...a, ...keepR.map((j) => b[j])]));
      return node(
        '⋈',
        { cols: [...L.cols, ...keepR.map((j) => R.cols[j])], rows },
        [l, r],
        common.length
          ? `Natural join on the common attribute(s) ${common.join(', ')}: combine tuples whose values match (${rows.length} result tuple(s)); the common attributes appear once.`
          : 'No common attributes, so the natural join is the same as the Cartesian product.',
      );
    }
  }
}

export function runRA(src: string, db: RelDb): RANode {
  return evalRA(parseRA(src), db);
}

/** Post-order list of steps (leaves first) for the step-by-step view. */
export function raSteps(n: RANode): RANode[] {
  return [...n.kids.flatMap(raSteps), n].filter((x) => x.op !== 'relation' || n.op === 'relation');
}

/** Compare two relations as sets, matching columns by name when possible. */
export function sameRelation(expected: Rel, got: Rel): { ok: boolean; msg: string } {
  if (expected.cols.length !== got.cols.length)
    return { ok: false, msg: `Your result has ${got.cols.length} attribute(s); the expected result has ${expected.cols.length} (${colLabels(expected).join(', ')}).` };
  const en = expected.cols.map((c) => c.name.toLowerCase());
  const gn = got.cols.map((c) => c.name.toLowerCase());
  const byName = [...en].sort().join() === [...gn].sort().join() && new Set(en).size === en.length;
  const perm = byName ? en.map((n) => gn.indexOf(n)) : en.map((_, i) => i);
  const g = new Set(got.rows.map((r) => key(perm.map((j) => r[j]))));
  const ex = new Set(expected.rows.map(key));
  const missing = [...ex].filter((k) => !g.has(k));
  const extra = [...g].filter((k) => !ex.has(k));
  if (!missing.length && !extra.length) return { ok: true, msg: 'Your expression produces exactly the expected relation.' };
  const fmt = (ks: string[]) => ks.slice(0, 4).map((k) => `(${(JSON.parse(k) as Val[]).join(', ')})`).join(' ');
  return {
    ok: false,
    msg: [
      `Expected ${ex.size} tuple(s), you produced ${g.size}.`,
      missing.length ? `Missing: ${fmt(missing)}${missing.length > 4 ? ' …' : ''}.` : '',
      extra.length ? `Unexpected: ${fmt(extra)}${extra.length > 4 ? ' …' : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
