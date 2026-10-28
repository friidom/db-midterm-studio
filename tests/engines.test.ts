import { describe, expect, it } from 'vitest';
import { simulateBuffer, parseRefs, bufSummary, bufStep, initBuf } from '../src/lib/sim/buffer';
import { runProbe, parseProbeOps, cuckooInsert, ehFromSpec, ehInsert, lhApply, type LHState, parseBloomOps, bloomApply } from '../src/lib/sim/hashing';
import { parseTree, insert, remove, treeToString, invariants, emptyTree } from '../src/lib/sim/bptree';
import { rle, bitmapEncode, deltaEncode, dictionaryEncode, bitsNeeded, alignWithPadding, alignWithReordering, lsmCompact, layoutAccess, newPage, slottedInsert, slottedDelete, slottedCompact, contiguousFree } from '../src/lib/sim/storage';
import { buildTrace, checkAsk } from '../src/lib/trace';
import { generate, GEN_INFO, fromGeneratedId, type GenKind } from '../src/lib/generators';

describe('buffer pool replacement', () => {
  it('LRU evicts the least recently used page and reports dirty write-backs', () => {
    const steps = simulateBuffer('LRU', 3, parseRefs('R1 R2 W3 R1 R4 R5'));
    expect(steps.map((s) => s.hit)).toEqual([false, false, false, true, false, false]);
    expect(steps[4].victim).toBe(2);
    expect(steps[5].victim).toBe(3);
    expect(steps[5].victimDirty).toBe(true);
  });

  it('MRU evicts the most recently used page (good for repeated sequential scans)', () => {
    const steps = simulateBuffer('MRU', 3, parseRefs('1 2 3 4 1 2 3 4'));
    expect(bufSummary(steps).hits).toBe(3);
    const lru = simulateBuffer('LRU', 3, parseRefs('1 2 3 4 1 2 3 4'));
    expect(bufSummary(lru).hits).toBe(0); // sequential flooding
  });

  it('CLOCK reproduces Lecture 4 slide 61: page2 then page1 are evicted', () => {
    // pages 1..4 resident with ref = 0, hand at frame 0
    let s = initBuf(4);
    for (const p of [1, 2, 3, 4]) s = bufStep(s, { page: p, write: false }, 'CLOCK', 0).after;
    s = bufStep(s, { page: 1, write: false }, 'CLOCK', 0).after; // access page1 → ref=1
    const evict1 = bufStep(s, { page: 5, write: false }, 'CLOCK', 0);
    expect(evict1.victim).toBe(2);
    s = evict1.after;
    s = bufStep(s, { page: 3, write: false }, 'CLOCK', 0).after;
    s = bufStep(s, { page: 4, write: false }, 'CLOCK', 0).after;
    const evict2 = bufStep(s, { page: 6, write: false }, 'CLOCK', 0);
    expect(evict2.victim).toBe(1);
  });

  it('LRU-2 evicts pages with fewer than two accesses first', () => {
    const steps = simulateBuffer('LRU2', 3, parseRefs('1 1 2 3 4'));
    expect(steps[4].victim).toBe(2); // 2 and 3 have +inf distance; 2 was accessed earlier
  });
});

describe('hash tables', () => {
  it('linear probing with tombstones (Lecture 5 slides 14–17)', () => {
    const steps = runProbe(7, parseProbeOps('+A:2 +B:0 +C:2 +D:3 -C:2 ?D:3 +G:3'));
    expect(steps[2].slot).toBe(3);
    expect(steps[3].slot).toBe(4);
    expect(steps[4].after[3]).toBe('tomb');
    expect(steps[5].result).toBe('found');
    expect(steps[5].probes).toEqual([3, 4]);
    expect(steps[6].slot).toBe(3); // tombstone reused
  });

  it('cuckoo hashing matches Lecture 5 slide 21', () => {
    const h: Record<string, [number, number]> = { A: [2, 5], B: [2, 0], C: [2, 0] };
    let t: (string | null)[] = Array(7).fill(null);
    for (const k of ['A', 'B', 'C']) t = cuckooInsert(t, k, h).after;
    expect(t[0]).toBe('C');
    expect(t[2]).toBe('B');
    expect(t[5]).toBe('A');
  });

  it('extendible hashing matches Lecture 5 slide 26', () => {
    let s = ehFromSpec('1:A=00010,X=01110 | 2:Y=10101,Z=10011 | 2:W=11010', 3, 2);
    expect(s.dir).toEqual([0, 0, 1, 2]);
    s = ehInsert(s, 'B', '10111').after;
    expect(s.global).toBe(2);
    const st = ehInsert(s, 'C', '10100');
    expect(st.after.global).toBe(3);
    const b100 = st.after.buckets[st.after.dir[4]];
    const b101 = st.after.buckets[st.after.dir[5]];
    expect(b100.keys.map((e) => e.h)).toEqual(['10011']);
    expect(b101.keys.map((e) => e.h).sort()).toEqual(['10100', '10101', '10111']);
    expect(b101.local).toBe(3);
    expect(st.after.dir.slice(0, 4).every((x) => x === st.after.dir[0])).toBe(true);
  });

  it('linear hashing matches Lecture 5 slides 28–30', () => {
    let s: LHState = { n0: 4, level: 0, next: 0, cap: 3, buckets: [[8, 20], [5, 9, 13], [6], [7, 11]] };
    const put = lhApply(s, '+', 17);
    expect(put.bucket).toBe(1);
    expect(put.split).toEqual({ from: 0, to: 4, moved: [20] });
    s = put.after;
    expect(s.next).toBe(1);
    expect(lhApply(s, '?', 20).bucket).toBe(4);
    expect(lhApply(s, '?', 9).bucket).toBe(1);
    const del = lhApply(s, '-', 20);
    expect(del.after.buckets.length).toBe(4);
    expect(del.after.next).toBe(0);
  });

  it('Bloom filter: no false negatives, ODB is a false positive (Lecture 7 slide 5)', () => {
    const ops = parseBloomOps('+RZA:6,4 +GZA:1,3 ?RZA:6,4 ?Raekwon:5,3 ?ODB:3,6', 8);
    let bits = Array(8).fill(0);
    const ins = new Set<string>();
    const res = ops.map((o) => {
      const st = bloomApply(bits, o, ins);
      bits = st.after;
      return st.result;
    });
    expect(bits).toEqual([0, 1, 0, 1, 1, 0, 1, 0]);
    expect(res.slice(2)).toEqual([true, false, true]);
  });
});

describe('B+Tree', () => {
  it('insert example 1 (max 3 keys): copy up 9', () => {
    let t = parseTree('[4 12] ([1 3] [5 9 10] [12 13])', 3);
    t = insert(t, 6).tree;
    expect(treeToString(t)).toBe('[4 9 12] ([1 3] [5 6] [9 10] [12 13])');
    t = insert(t, 8).tree;
    expect(treeToString(t)).toBe('[4 9 12] ([1 3] [5 6 8] [9 10] [12 13])');
  });

  it('insert example 3 (max 4 keys): root split pushes 13 up', () => {
    let t = parseTree('[5 9 13 19] ([1 3] [5 7] [9 11] [13 14 15] [20 21 23])', 4);
    t = insert(t, 17).tree;
    t = insert(t, 16).tree;
    expect(treeToString(t)).toBe('[13] ([5 9] ([1 3] [5 7] [9 11]) [16 19] ([13 14 15] [16 17] [20 21 23]))');
    expect(invariants(t)).toEqual([]);
  });

  it('delete examples 2 and 3: borrow, then merge and shrink', () => {
    let t = parseTree('[13] ([5 9] ([1 3] [5 7] [9 11]) [17 21] ([13 15] [17 19 20] [21 23]))', 4);
    t = remove(t, 15).tree;
    expect(treeToString(t)).toBe('[13] ([5 9] ([1 3] [5 7] [9 11]) [19 21] ([13 17] [19 20] [21 23]))');
    t = remove(t, 19).tree;
    expect(treeToString(t)).toBe('[5 9 13 19] ([1 3] [5 7] [9 11] [13 17] [20 21 23])');
    expect(invariants(t)).toEqual([]);
  });

  it('delete example 1 (frames p49–52): borrow from the rich right sibling', () => {
    const t = remove(parseTree('[4 9] ([1 3] [5 6] [9 12 14])', 3), 6).tree;
    expect(treeToString(t)).toBe('[4 12] ([1 3] [5 9] [12 14])');
  });

  it('random inserts and deletes keep every invariant', () => {
    for (const max of [3, 4, 5]) {
      let t = emptyTree(max);
      const keys = Array.from({ length: 60 }, (_, i) => (i * 37) % 101);
      for (const k of keys) t = insert(t, k).tree;
      expect(invariants(t)).toEqual([]);
      for (const k of keys.slice(0, 45)) t = remove(t, k).tree;
      expect(invariants(t)).toEqual([]);
    }
  });
});

describe('storage engines', () => {
  const col = ['Y', 'Y', 'Y', 'N', 'Y', 'N', 'Y', 'Y'];
  it('RLE / bitmap / delta / dictionary match Lecture 4 slides', () => {
    expect(rle(col)).toEqual([['Y', 0, 3], ['N', 3, 1], ['Y', 4, 1], ['N', 5, 1], ['Y', 6, 2]]);
    expect(rle([...col].sort().reverse())).toEqual([['Y', 0, 6], ['N', 6, 2]]);
    expect(bitmapEncode(col)[0].bits.join('')).toBe('11101011');
    expect(deltaEncode([99.5, 99.4, 99.5, 99.6, 99.4]).deltas).toEqual([-0.1, 0.1, 0.1, -0.2]);
    expect(dictionaryEncode(['Andrea', 'Mr.Pickles', 'Andy', 'Jignesh', 'Mr.Pickles']).codes).toEqual([10, 40, 20, 30, 40]);
    expect(bitsNeeded(231)).toBe(8);
  });

  it('word alignment (Lecture 3 slides 41–43): 3 words either way', () => {
    const attrs = [
      { name: 'id', bits: 32 },
      { name: 'cdate', bits: 64 },
      { name: 'color', bits: 16 },
      { name: 'zipcode', bits: 32 },
    ];
    const p = alignWithPadding(attrs);
    expect(p.words).toBe(3);
    expect(p.padBits).toBe(48);
    expect(alignWithReordering(attrs).words).toBe(3);
  });

  it('LSM compaction keeps only the newest record per key (Lecture 3 slide 35)', () => {
    const merged = lsmCompact(
      [
        { op: 'DEL', key: 'key100' },
        { op: 'PUT', key: 'key101', val: 'a3' },
        { op: 'PUT', key: 'key102', val: 'b2' },
        { op: 'PUT', key: 'key103', val: 'c1' },
      ],
      [
        { op: 'PUT', key: 'key101', val: 'a2' },
        { op: 'PUT', key: 'key102', val: 'b1' },
        { op: 'DEL', key: 'key103' },
        { op: 'PUT', key: 'key104', val: 'd2' },
      ],
    );
    expect(merged.map((r) => `${r.op}:${r.key}:${r.val ?? ''}`)).toEqual(['DEL:key100:', 'PUT:key101:a3', 'PUT:key102:b2', 'PUT:key103:c1', 'PUT:key104:d2']);
  });

  it('layout access model: NSM wins point lookups, DSM/PAX win narrow scans', () => {
    const point = { id: 'p', label: '', sql: '', kind: 'point' as const, cols: [0, 1, 2, 3], rows: [5] };
    const scan = { id: 's', label: '', sql: '', kind: 'scan' as const, cols: [3], rows: 'all' as const };
    expect(layoutAccess('NSM', 8, 4, point).units.length).toBe(1);
    expect(layoutAccess('DSM', 8, 4, point).units.length).toBe(4);
    expect(layoutAccess('NSM', 8, 4, scan).cellsRead).toBe(32);
    expect(layoutAccess('DSM', 8, 4, scan).cellsRead).toBe(8);
    expect(layoutAccess('PAX', 8, 4, scan).cellsRead).toBe(8);
  });

  it('slotted page keeps record ids stable across compaction', () => {
    let p = newPage(128, 8, 4);
    p = slottedInsert(p, 20, 't1').page;
    p = slottedInsert(p, 30, 't2').page;
    p = slottedInsert(p, 20, 't3').page;
    p = slottedDelete(p, 1).page;
    const before = contiguousFree(p);
    p = slottedCompact(p).page;
    expect(contiguousFree(p)).toBe(before + 30);
    expect(p.slots[2]?.label).toBe('t3');
    expect(slottedInsert(p, 10, 't4').slot).toBe(1); // freed slot is reused
  });
});

describe('traces and generators', () => {
  it('every generator produces a well-formed, self-consistent question', () => {
    for (const kind of Object.keys(GEN_INFO) as GenKind[]) {
      for (const seed of [1, 2, 3, 42, 99]) {
        const q = generate(kind, seed);
        expect(q.id).toBe(`g:${kind}:${seed}`);
        expect(fromGeneratedId(q.id)?.prompt).toBe(q.prompt);
        if (q.type === 'trace') {
          const steps = buildTrace(q.trace);
          expect(steps.length).toBeGreaterThan(0);
          for (const st of steps) for (const a of st.asks) expect(checkAsk(a, a.answer)).toBe(true);
        }
      }
    }
  });
});
