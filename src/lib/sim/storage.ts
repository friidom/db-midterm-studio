// Storage engines: compression (L4 s33–44), word alignment (L3 s41–43),
// slotted pages (L3 s23–24), LSM compaction (L3 s35), NSM/DSM/PAX access model (L4 s11–24).

/* ---------- Columnar compression ---------- */

/** Run-length encoding as (value, start offset, run length) triplets — offsets are 0-based as on L4 s35. */
export function rle<T>(values: T[]): [T, number, number][] {
  const out: [T, number, number][] = [];
  values.forEach((v, i) => {
    const last = out[out.length - 1];
    if (last && last[0] === v) last[2]++;
    else out.push([v, i, 1]);
  });
  return out;
}

export function bitmapEncode(values: string[]): { value: string; bits: number[] }[] {
  const distinct = [...new Set(values)];
  return distinct.map((value) => ({ value, bits: values.map((v) => (v === value ? 1 : 0)) }));
}

/** Delta encoding: base value + successive differences. */
export function deltaEncode(values: number[]): { base: number; deltas: number[] } {
  return { base: values[0], deltas: values.slice(1).map((v, i) => +(v - values[i]).toFixed(6)) };
}

/** Frame of reference: subtract the global minimum. */
export function frameOfReference(values: number[]): { base: number; offsets: number[] } {
  const base = Math.min(...values);
  return { base, offsets: values.map((v) => +(v - base).toFixed(6)) };
}

/** Bits needed to store non-negative integers up to `max`. */
export const bitsNeeded = (max: number) => Math.max(1, Math.ceil(Math.log2(max + 1)));

/** Order-preserving dictionary: codes follow the sort order of the values. */
export function dictionaryEncode(values: string[], step = 10): { dict: { value: string; code: number }[]; codes: number[] } {
  const dict = [...new Set(values)].sort().map((value, i) => ({ value, code: (i + 1) * step }));
  const code = new Map(dict.map((d) => [d.value, d.code]));
  return { dict, codes: values.map((v) => code.get(v) as number) };
}

/* ---------- Word alignment ---------- */

export interface Attr {
  name: string;
  bits: number;
}
export interface Placed {
  name: string;
  start: number;
  bits: number;
  pad?: boolean;
}

/** Padding (L3 s42): keep declaration order; an attribute that would straddle a word boundary starts a new word. */
export function alignWithPadding(attrs: Attr[], word = 64): { cells: Placed[]; words: number; padBits: number } {
  const cells: Placed[] = [];
  let pos = 0;
  let padBits = 0;
  for (const a of attrs) {
    const used = pos % word;
    if (used !== 0 && used + a.bits > word) {
      const pad = word - used;
      cells.push({ name: 'pad', start: pos, bits: pad, pad: true });
      padBits += pad;
      pos += pad;
    }
    cells.push({ name: a.name, start: pos, bits: a.bits });
    pos += a.bits;
  }
  const tail = pos % word ? word - (pos % word) : 0;
  if (tail) {
    cells.push({ name: 'pad', start: pos, bits: tail, pad: true });
    padBits += tail;
    pos += tail;
  }
  return { cells, words: pos / word, padBits };
}

/** Reordering (L3 s43): largest attributes first, then fill the remaining gaps (first fit). */
export function alignWithReordering(attrs: Attr[], word = 64): { order: string[]; words: number; padBits: number } {
  const bins: { free: number; names: string[] }[] = [];
  for (const a of [...attrs].sort((x, y) => y.bits - x.bits)) {
    const bin = bins.find((b) => b.free >= a.bits);
    if (bin) {
      bin.free -= a.bits;
      bin.names.push(a.name);
    } else bins.push({ free: word - a.bits, names: [a.name] });
  }
  return { order: bins.flatMap((b) => b.names), words: bins.length, padBits: bins.reduce((s, b) => s + b.free, 0) };
}

/* ---------- Slotted page ---------- */

export interface SlotEntry {
  off: number;
  len: number;
  label: string;
}
export interface SlottedPage {
  size: number;
  header: number;
  slotBytes: number;
  slots: (SlotEntry | null)[];
  freeEnd: number; // tuple data starts here and grows towards the front
}

export const newPage = (size = 512, header = 24, slotBytes = 4): SlottedPage => ({ size, header, slotBytes, slots: [], freeEnd: size });

export const slotArrayEnd = (p: SlottedPage) => p.header + p.slots.length * p.slotBytes;
export const contiguousFree = (p: SlottedPage) => p.freeEnd - slotArrayEnd(p);
export const usedTupleBytes = (p: SlottedPage) => p.slots.reduce((a, s) => a + (s ? s.len : 0), 0);
export const fragmentedBytes = (p: SlottedPage) => p.size - p.freeEnd - usedTupleBytes(p);

export function slottedInsert(p0: SlottedPage, len: number, label: string): { page: SlottedPage; slot: number | null; msg: string } {
  const p: SlottedPage = { ...p0, slots: [...p0.slots] };
  const reuse = p.slots.indexOf(null);
  const need = len + (reuse >= 0 ? 0 : p.slotBytes);
  if (contiguousFree(p) < need) {
    const total = contiguousFree(p) + fragmentedBytes(p);
    return {
      page: p0,
      slot: null,
      msg:
        total >= need
          ? `Not enough contiguous free space (${contiguousFree(p)} B) for ${need} B, but ${fragmentedBytes(p)} B are fragmented → compact the page first.`
          : `Page full: need ${need} B, only ${total} B free in total → the tuple goes to another page (page directory finds one).`,
    };
  }
  p.freeEnd -= len;
  const entry = { off: p.freeEnd, len, label };
  const slot = reuse >= 0 ? reuse : p.slots.length;
  if (reuse >= 0) p.slots[reuse] = entry;
  else p.slots.push(entry);
  return {
    page: p,
    slot,
    msg: `Store ${label} (${len} B) at offset ${p.freeEnd} (data grows from the end). Slot ${slot + 1} ${reuse >= 0 ? 'is reused' : 'is appended to the slot array'} → record ID = (page, slot ${slot + 1}).`,
  };
}

export function slottedDelete(p0: SlottedPage, slot: number): { page: SlottedPage; msg: string } {
  const p: SlottedPage = { ...p0, slots: [...p0.slots] };
  const e = p.slots[slot];
  if (!e) return { page: p0, msg: `Slot ${slot + 1} is already empty.` };
  p.slots[slot] = null;
  return { page: p, msg: `Delete ${e.label}: slot ${slot + 1} is marked empty. Its ${e.len} B become a hole (fragmentation) until the page is compacted.` };
}

export function slottedCompact(p0: SlottedPage): { page: SlottedPage; msg: string } {
  const p: SlottedPage = { ...p0, slots: p0.slots.map((s) => (s ? { ...s } : null)) };
  let end = p.size;
  const live = p.slots.map((s, i) => ({ s, i })).filter((x) => x.s) as { s: SlotEntry; i: number }[];
  live.sort((a, b) => b.s.off - a.s.off);
  for (const { s } of live) {
    end -= s.len;
    s.off = end;
  }
  p.freeEnd = end;
  return { page: p, msg: 'Compaction slides tuples together at the end of the page and updates their slot offsets. Slot numbers do not change, so record IDs stay valid.' };
}

/* ---------- Log-structured compaction ---------- */

export interface LsmRec {
  op: 'PUT' | 'DEL';
  key: string;
  val?: string;
}

/** Sort-merge SSTables; for each key keep only the newest record. `newer` wins over `older`. */
export function lsmCompact(newer: LsmRec[], older: LsmRec[]): LsmRec[] {
  const out = new Map<string, LsmRec>();
  for (const r of older) out.set(r.key, r);
  for (const r of newer) out.set(r.key, r);
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const lsmText = (r: LsmRec) => `${r.op} (${r.key}${r.val ? ', ' + r.val : ''})`;

/* ---------- NSM / DSM / PAX access model ---------- */

export type Layout = 'NSM' | 'DSM' | 'PAX';

export interface LayoutQuery {
  id: string;
  label: string;
  sql: string;
  kind: 'point' | 'scan' | 'insert';
  cols: number[]; // columns needed
  rows: number[] | 'all';
}

export interface Unit {
  id: string; // e.g. "page 2", "col city", "RG1·amount"
  cells: [number, number][]; // [row, col]
}

export interface Access {
  units: Unit[];
  cellsRead: number;
  cellsUseful: number;
  writes: number;
  note: string;
}

/**
 * Toy physical model: NSM pages hold `rowsPerPage` complete rows; DSM stores each column in its own
 * page(s) of `valuesPerPage`; PAX keeps row groups of `groupRows` rows, each split into column chunks.
 * Reads happen at page (NSM/DSM) or column-chunk (PAX) granularity.
 */
export function layoutAccess(
  layout: Layout,
  nRows: number,
  nCols: number,
  q: LayoutQuery,
  geo = { rowsPerPage: 2, valuesPerPage: 8, groupRows: 4 },
): Access {
  const needRows = q.rows === 'all' ? Array.from({ length: nRows }, (_, i) => i) : q.rows;
  const useful = new Set(needRows.flatMap((r) => q.cols.map((c) => `${r},${c}`)));
  const units: Unit[] = [];
  const addUnit = (id: string, cells: [number, number][]) => {
    if (!units.some((u) => u.id === id)) units.push({ id, cells });
  };
  if (q.kind === 'insert') {
    const writes = layout === 'NSM' ? 1 : layout === 'DSM' ? nCols : nCols;
    const note =
      layout === 'NSM'
        ? 'One page write: the whole new tuple is stored contiguously in a single slotted page.'
        : layout === 'DSM'
          ? `${nCols} writes: the tuple is split and one value is appended to each column’s pages.`
          : `The new row is buffered and written as part of a row group (${nCols} column chunks). Formats like Parquet are immutable files, so single-row inserts are batched — PAX is not built for many small writes.`;
    return { units, cellsRead: 0, cellsUseful: 0, writes, note };
  }
  for (const r of needRows) {
    if (layout === 'NSM') {
      const p = Math.floor(r / geo.rowsPerPage);
      const cells: [number, number][] = [];
      for (let rr = p * geo.rowsPerPage; rr < Math.min(nRows, (p + 1) * geo.rowsPerPage); rr++) for (let c = 0; c < nCols; c++) cells.push([rr, c]);
      addUnit(`page ${p + 1}`, cells);
    } else if (layout === 'DSM') {
      for (const c of q.cols) {
        const p = Math.floor(r / geo.valuesPerPage);
        const cells: [number, number][] = [];
        for (let rr = p * geo.valuesPerPage; rr < Math.min(nRows, (p + 1) * geo.valuesPerPage); rr++) cells.push([rr, c]);
        addUnit(`column ${c} page ${p + 1}`, cells);
      }
    } else {
      const g = Math.floor(r / geo.groupRows);
      for (const c of q.cols) {
        const cells: [number, number][] = [];
        for (let rr = g * geo.groupRows; rr < Math.min(nRows, (g + 1) * geo.groupRows); rr++) cells.push([rr, c]);
        addUnit(`row group ${g + 1} · column ${c}`, cells);
      }
    }
  }
  const cellsRead = units.reduce((a, u) => a + u.cells.length, 0);
  const cellsUseful = useful.size;
  const waste = cellsRead - cellsUseful;
  const note =
    layout === 'NSM'
      ? q.kind === 'point'
        ? 'One page holds the whole tuple → a single read gives every attribute. Ideal for OLTP point queries.'
        : `Every page must be read, including ${waste} cells of attributes the query never uses (“useless data”).`
      : layout === 'DSM'
        ? q.kind === 'point'
          ? `The tuple is spread over ${q.cols.length} column(s): one read per column, then the values must be stitched back together.`
          : 'Only the columns the query needs are read — no wasted I/O, and similar values sit together (better compression).'
        : q.kind === 'point'
          ? 'Only the row group holding the tuple is touched; its column chunks sit close together in the file, so reconstructing the tuple stays local.'
          : 'Only the needed column chunks of each row group are read, so scans get columnar efficiency while each row group keeps its rows together.';
  return { units, cellsRead, cellsUseful, writes: 0, note };
}
