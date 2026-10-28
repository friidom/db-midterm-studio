import type { Lesson, Question } from '../lib/types';
import { L } from './modules';

export const lessons: Lesson[] = [
  {
    id: 'm8-l1', module: 'm8', title: 'Bloom filters and other filters', minutes: 14,
    summary: 'A filter answers “might this key exist?” with a small bitmap: no false negatives, occasional false positives.',
    objectives: ['Distinguish an index from a filter', 'Trace Bloom filter inserts and lookups', 'Explain false positives vs false negatives', 'Name counting Bloom, cuckoo and range filters'],
    sources: [L(7, '2–6')],
    blocks: [
      {
        k: 'concept',
        c: {
          title: 'Bloom filters',
          intuition: 'Each key flips a few bits in a bitmap. To ask about a key, check its bits: any 0 means “definitely never inserted”; all 1s means “probably inserted” — other keys may have set those bits.',
          why: 'A tiny in-memory filter can skip expensive disk reads for keys that do not exist (LSM levels, hash-table buckets, joins).',
          definition: 'An **index** locates tuples; a **filter** answers set-membership queries — whether a key (likely) exists, not where (slide 2). A **Bloom filter** is a probabilistic bitmap: **Insert(x)** uses k hash functions to set bits to 1; **Lookup(x)** checks that the bit for every hash function is 1. **False negatives never occur; false positives can** (slide 4). Other filters (slide 6): **counting Bloom filter** (integers instead of bits → supports deletes), **cuckoo filter** (cuckoo table of fingerprints → supports deletes), **SuRF** (immutable compact trie for approximate matches and range filtering).',
          example: [{ k: 'widget', w: 'bloom' }],
          walkthrough: {
            title: 'Lecture 7, slide 5 (8 bits, k = 2)',
            steps: [
              { md: 'Insert RZA: 2222 % 8 = 6, 4444 % 8 = 4 → bits 4 and 6. Insert GZA: sets bits 1 and 3 → bitmap 0 1 0 1 1 0 1 0.' },
              { md: 'Lookup RZA: bits 6 and 4 are 1 → TRUE.' },
              { md: 'Lookup Raekwon: 3333 % 8 = 5 → bit 5 is 0 → FALSE (certain).' },
              { md: 'Lookup ODB: 6699 % 8 = 3, 9966 % 8 = 6 → both 1 → TRUE, although ODB was never inserted: a **false positive**.' },
            ],
          },
          mistakes: [{ wrong: '“A Bloom filter can say a present key is absent.”', right: 'Never — an inserted key’s bits are all 1 (with no deletes). Only “present” answers can be wrong.' }],
          check: 'm8-c1',
        },
      },
    ],
  },
  {
    id: 'm8-l2', module: 'm8', title: 'Skip lists, tries and radix trees', minutes: 16,
    summary: 'Two more ordered in-memory structures: skip lists (layered linked lists, no rebalancing) and tries/radix trees (search by key digits, O(k)).',
    objectives: ['Search and insert in a skip list', 'List skip list pros and cons', 'Explain tries, key span and radix (Patricia) trees'],
    sources: [L(7, '7–19')],
    blocks: [
      {
        k: 'concept',
        c: {
          title: 'Skip lists',
          intuition: 'A sorted linked list with express lanes: higher levels skip over many keys, so a search drops down a level whenever it would overshoot.',
          why: 'A sorted linked list costs O(n) per operation (slide 7); skip lists get about O(log n) without any rebalancing — popular for LSM MemTables.',
          definition: 'Level 1 is a sorted list of all keys, level 2 has every other key, level 3 every fourth — each higher level halves the keys; ≈ O(log n) search (slide 8). **Insert:** flip a coin to decide how many levels the new key joins (slide 9). **Search:** start at the top level, move right while the next key is smaller, otherwise go down (slide 10). **Delete:** first logically remove (set a flag), then physically remove once no thread holds a reference (slides 11–12). Pros: less memory than a typical B+Tree (no reverse pointers), no rebalancing. Cons: not disk/cache friendly, reverse search is non-trivial (slide 13).',
          mistakes: [{ wrong: '“Skip lists rebalance like B+Trees.”', right: 'Levels are chosen randomly at insert time; there is no global rebalancing.' }],
          check: 'm8-c2',
        },
      },
      {
        k: 'concept',
        c: {
          title: 'Tries and radix trees',
          intuition: 'Spell the key letter by letter down the tree: H → A → T. The path *is* the key.',
          why: 'B+Tree inner keys cannot prove a key is absent — you must reach a leaf, possibly missing in the buffer pool at every level (slide 14). A trie can stop as soon as a digit is missing.',
          definition: 'A **trie** (digital search / prefix tree) examines a key’s prefixes one by one; its shape depends only on the keys, **not on insertion order**; no rebalancing; operations are **O(k)** for key length k; a root-to-leaf path represents a key (slide 15). The **span** is the number of bits per digit; it determines fanout and height (an n-way trie has fanout n) (slides 16–17). A **radix tree** (Patricia tree) vertically compresses nodes with a single child; it can produce **false positives**, so the DBMS checks the original tuple (slide 18).',
          mistakes: [{ wrong: '“A trie’s height depends on how many keys it holds.”', right: 'It depends on the key length (and span), not on the number of keys.' }],
          check: 'm8-c3',
        },
      },
    ],
  },
  {
    id: 'm8-l3', module: 'm8', title: 'Inverted and vector indexes', minutes: 10,
    summary: 'Indexes for searching data by content: inverted (full-text) indexes map terms to posting lists; vector indexes find nearest neighbours of embeddings.',
    objectives: ['Explain an inverted index and posting lists', 'Describe Lucene and PostgreSQL GIN at a high level', 'Describe IVF and HNSW vector indexes'],
    sources: [L(7, '20–28')],
    blocks: [
      {
        k: 'concept',
        c: {
          title: 'Inverted and vector indexes',
          intuition: 'Like the index at the back of a textbook: each word points to the pages that contain it. Vector indexes do the same for “meaning”: find the stored embeddings closest to the query’s.',
          why: 'B+Trees and hash tables answer point and range queries, but are poor at keyword search such as “articles containing ‘Pavlo’” (slide 20).',
          definition: 'An **inverted index** maps terms to the records containing them (full-text search index), e.g. Wu-Tang → [11, 44], Carnegie → [22, 33, 44] (slide 21). Lucene uses a finite state transducer for the term dictionary, builds segments incrementally and merges them in the background (slide 22). PostgreSQL **GIN** uses a B+Tree term dictionary pointing to posting lists (a sorted record-ID list, or a B+Tree of record IDs when large) plus a pending list for updates (slide 23). **Vector indexes** do nearest-neighbour search on embeddings (arrays of floats): **IVF** (IVFFlat) clusters vectors and scans the query’s cluster (and nearby ones); **HNSW** (navigable small worlds) builds a multi-level neighbour graph and greedily moves closer to the query (slides 25–27).',
          mistakes: [{ wrong: '“A B+Tree on a text column supports ‘contains word X’ queries.”', right: 'It supports prefixes and ranges; containment search needs an inverted index.' }],
          check: 'm8-c4',
        },
      },
    ],
  },
];

export const questions: Question[] = [
  {
    id: 'm8-c1', module: 'm8', skills: ['ix-bloom'], level: 2, type: 'trace', use: ['check', 'practice', 'test'],
    trace: { sim: 'bloom', m: 8, ops: '+RZA:6,4 +GZA:1,3 ?RZA:6,4 ?Raekwon:5,3 ?ODB:3,6' },
    prompt: 'Replay Lecture 7, slide 5: an **8-bit** Bloom filter with **2 hash functions** (positions shown). Predict the bits and each lookup.',
    hints: ['A single 0 bit means FALSE.'],
    explain: 'RZA sets 4 and 6; GZA sets 1 and 3. RZA → TRUE; Raekwon hits bit 5 (0) → FALSE; ODB hits bits 3 and 6, both set by other keys → TRUE although never inserted (false positive).',
    source: 'Lecture 7, slides 4–5',
  },
  {
    id: 'm8-c2', module: 'm8', skills: ['ix-skip'], level: 1, type: 'multi', use: ['check', 'practice', 'test', 'exam'],
    prompt: 'Which are properties of **skip lists** according to Lecture 7?',
    options: ['Approximately O(log n) search', 'Insertions and deletions require no rebalancing', 'Very disk/cache friendly', 'Reverse (backwards) search is non-trivial', 'Often used for LSM MemTables'],
    answer: [0, 1, 3, 4],
    why: [undefined, undefined, 'Poor locality of reference: not disk/cache friendly.', undefined, undefined],
    explain: 'Slides 8 and 13: ≈ O(log n) search, no rebalancing, less memory than a typical B+Tree; but poor locality and hard reverse search; mostly in-memory (e.g. an LSM MemTable).',
    source: 'Lecture 7, slides 8, 13',
  },
  {
    id: 'm8-c3', module: 'm8', skills: ['ix-trie'], level: 2, type: 'mcq', use: ['check', 'practice', 'test', 'exam'],
    prompt: 'Which statement about a **trie** is correct?',
    options: ['Its shape depends on the insertion order', 'Operations cost O(k) for a key of length k, and the shape depends only on the keys', 'It needs rebalancing after inserts', 'It stores keys only in the root'],
    answer: 1,
    explain: 'A trie examines a key digit by digit: O(k) per operation, shape independent of insertion order, no rebalancing; keys are implicit in the root-to-leaf paths (slide 15).',
    source: 'Lecture 7, slide 15',
  },
  {
    id: 'm8-c4', module: 'm8', skills: ['ix-inverted'], level: 1, type: 'mcq', use: ['check', 'practice', 'test', 'exam'],
    prompt: 'You need “find all articles that contain the word *Pavlo*”. Which index fits?',
    options: ['B+Tree on the article text', 'Hash index on the article text', 'Inverted (full-text) index', 'Bloom filter'],
    answer: 2,
    explain: 'B+Trees and hash tables support point and range queries but are poor at keyword search (slide 20). An inverted index maps each term to the records containing it (slide 21).',
    source: 'Lecture 7, slides 20–21',
  },
  {
    id: 'm8-q1', module: 'm8', skills: ['ix-bloom'], level: 1, type: 'mcq',
    prompt: 'A Bloom filter lookup for key X returns **FALSE**. What do we know?',
    options: ['X is probably not in the set', 'X is definitely not in the set', 'X is definitely in the set', 'Nothing'],
    answer: 1,
    explain: 'If X had been inserted, all its bits would be 1. A 0 bit proves X was never inserted: Bloom filters have no false negatives (slide 4).',
    source: 'Lecture 7, slide 4',
  },
  {
    id: 'm8-q2', module: 'm8', skills: ['ix-bloom'], level: 2, type: 'mcq',
    prompt: 'Why can a plain Bloom filter **not support deletes**, and what fixes it?',
    options: ['Bits cannot be cleared; use a skip list', 'Clearing a bit may also “remove” other keys that share it; a counting Bloom filter (counters instead of bits) or a cuckoo filter supports deletes', 'Deletes are fine; just clear the bits', 'Bloom filters store keys, so they need rehashing'],
    answer: 1,
    explain: 'Bits are shared between keys, so clearing one could create false negatives. Counting Bloom filters keep counts per position; cuckoo filters store fingerprints that can be removed (slide 6).',
    source: 'Lecture 7, slide 6',
  },
  {
    id: 'm8-q3', module: 'm8', skills: ['ix-skip'], level: 2, type: 'mcq',
    prompt: 'How does a new key decide **how many levels** of a skip list it joins?',
    options: ['Always all levels', 'Randomly — flip a coin per level', 'By its hash value modulo the number of levels', 'Based on the current height of the tree'],
    answer: 1,
    explain: 'Insert flips a coin to decide how many levels to add the new key into, so on average each level holds half the keys of the level below (slides 8–9).',
    source: 'Lecture 7, slides 8–9',
  },
  {
    id: 'm8-q4', module: 'm8', skills: ['ix-trie'], level: 2, type: 'mcq',
    prompt: 'Why can a **radix tree** return false positives?',
    options: ['It uses hash functions', 'It compresses chains of single-child nodes, so it does not store every digit of the key — the DBMS must check the original tuple', 'It is probabilistic like a Bloom filter', 'It stores only the first byte of each key'],
    answer: 1,
    explain: 'Vertical compression skips digits stored in the collapsed path, so a lookup can reach a key that only matches on the digits that were kept; checking the tuple confirms it (slide 18).',
    source: 'Lecture 7, slide 18',
  },
  {
    id: 'm8-q5', module: 'm8', skills: ['ix-inverted'], level: 2, type: 'mcq',
    prompt: 'How does an **IVF (inverted file) vector index** answer a nearest-neighbour query?',
    options: ['Scan all vectors', 'Map the query vector to its cluster (group) and scan that cluster’s vectors, optionally nearby clusters too', 'Binary-search a B+Tree of vectors', 'Hash the vector exactly'],
    answer: 1,
    explain: 'IVF partitions vectors into groups with a clustering algorithm; a query scans its group (and neighbours for accuracy). HNSW instead walks a neighbour graph greedily (slides 26–27).',
    source: 'Lecture 7, slides 25–27',
  },
  {
    id: 'm8-q6', module: 'm8', skills: ['ix-bloom'], level: 1, type: 'mcq',
    prompt: 'What is the key difference between an **index** and a **filter**?',
    options: ['An index is probabilistic, a filter is exact', 'An index locates the tuples for a key; a filter only says whether the key (likely) exists, not where it is', 'A filter is always stored on disk', 'There is no difference'],
    answer: 1,
    explain: 'An index organises/sorts attributes to locate specific tuples (e.g. a B+Tree). A filter answers set-membership queries — whether a key likely exists — but not its location (e.g. a Bloom filter) (Lecture 7, slide 2).',
    source: 'Lecture 7, slide 2',
  },
  {
    id: 'm8-q7', module: 'm8', skills: ['ix-skip'], level: 2, type: 'mcq',
    prompt: 'Searching a skip list for K3: you are on the top level and the next key there is K5 (K3 < K5). What do you do?',
    options: ['Move right to K5', 'Go down one level from the current position', 'Restart from the bottom level', 'Report “not found”'],
    answer: 1,
    explain: 'Move right only while the next key is smaller than the search key; otherwise drop down a level. Slide 10: K3 < K5 → down; K3 > K2 → right; K3 < K4 → down; then K3 is found on level 1.',
    source: 'Lecture 7, slide 10',
  },
  {
    id: 'm8-q8', module: 'm8', skills: ['ix-inverted'], level: 2, type: 'mcq',
    prompt: 'In PostgreSQL’s GIN index, how is the posting list of a **very frequent** term stored?',
    options: ['As one sorted list of record IDs, whatever its size', 'As a B+Tree of record IDs (a posting tree); small lists stay as sorted lists', 'In a Bloom filter', 'In the pending list forever'],
    answer: 1,
    explain: 'GIN’s term dictionary is a B+Tree; each term points to a posting list. Few records → a sorted list of record IDs; many records → a B+Tree of record IDs. A separate pending list batches incremental updates (Lecture 7, slide 23).',
    source: 'Lecture 7, slide 23',
  },
];
