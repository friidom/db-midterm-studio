# Source notes (extracted from the course PDFs)

Citations use the **slide number printed in each slide footer** ("X / N"), not the PDF page.
PDF page ranges are given where an animated slide spans several PDF pages.

## Syllabus — `Databases_Syllabus.pdf` (SOC3020, v2.2, 2026.09)
- Midterm: **Week 7, covers Weeks 1–6**: "relational reasoning, SQL, storage, buffering and indexing".
- Exams assess "algorithm traces, invariants, cost calculations and transaction/recovery reasoning".
- Week 1 Relational Model & Algebra · Week 2 Modern SQL (incl. NULL + three-valued logic, duplicates, cardinality)
- Week 3 Database Storage (pages, slotted pages, record IDs, tuple encoding, var-length fields, deletion & compaction, row/column/hybrid layouts, compression, log-structured)
- Week 4 Buffer Pool (frames, page tables, pin counts, dirty pages, eviction, flushing, replacement policies)
- Week 5 Hash Tables (hash functions, collisions, static & dynamic hashing, resizing, probing, access cost; compare with ordered indexes & filters)
- Week 6 B+Trees (separators, occupancy, lookup, scans, insert/delete, split/merge/redistribute; **also lists leaf links, tombstones, iterators, latch coupling, safe nodes, deadlock avoidance**)
- Weeks 8–14 (sorting/joins, execution, optimization, concurrency, MVCC, logging, recovery) → **final exam only**.

### Discrepancies / gaps found
1. Syllabus Week 6 lists *latch coupling, safe nodes, deadlock avoidance* (index concurrency control). **No provided slide covers these.** Taught in the app as a clearly-labelled supplementary lesson.
2. Syllabus Week 2 lists *NULL and three-valued logic*; Lecture 2 slides do not show NULL examples (Lecture 1 slide 29 only says "NULL belongs to every domain"). Taught as a labelled supplementary lesson using standard SQL semantics.
3. Lecture 7 (Indexes & Filters) is not named in the syllabus week list, but the midterm covers "indexing" and Week 5 says "compare … with ordered indexes and filters". Treated as in scope, lower weight.
4. Lecture 6 slide 17: first frame shows right leaf `[9,10,12]`, later frames show `[9,12,14]` (slide inconsistency). The app uses its own consistent numbers.
5. Lecture 4 slide 37: original value `191` appears as `181` in the compressed column (typo in slide).
6. Lecture 4 slide 61 (CLOCK) draws the newly loaded page5 with `ref=0`, while the rule text says "accessing a page sets its bit to 1". The simulator states its convention explicitly.
7. No sample exam / past paper / assignment spec is in the folder → exam format unknown; Exam Mode is a clearly-labelled *practice* format.

8. Lecture 4 slide 35 (sorted RLE) shows `(N,7,2)`; with the 0-based offsets used on the same slide (`(Y,0,6)`) the N-run starts at offset **6** → `(N,6,2)`. The app teaches `(N,6,2)` and flags the slide typo.

## Lecture 1 (`lecture1-1.pdf`) — relational model & algebra
- s13 Database = organized collection of inter-related data modelling some aspect of the real world. s15–19 flat-file strawman problems (integrity, implementation, durability). s20 DBMS. s21 data model vs schema. s26–27 relational model tenets (structure, integrity, manipulation). s28 logical vs physical data independence.
- s29 Relation = unordered set; tuple = set of attribute values (atomic/scalar; NULL in every domain if allowed); n-ary. Artist(name,year,country): (Wu-Tang Clan,1992,USA) (Notorious BIG,1992,USA) (GZA,1990,USA).
- s30 Primary key (IDENTITY / SEQUENCE / AUTO_INCREMENT). s31 Foreign key: ArtistAlbum(artist_id,album_id) = (101,11)(101,22)(103,22)(102,22); Artist(id,…) 101 Wu-Tang Clan, 102 Notorious BIG, 103 GZA; Album(id,name,year) 11 Enter the Wu-Tang 1993, 22 St.Ides Mix Tape 1994, 33 Liquid Swords 1995.
- s32 Constraints (unique + referential most common; SQL:92 assertions rarely used). s33 DML: procedural (relational algebra) vs non-procedural/declarative (relational calculus).
- s34 RA is set-based; operators σ π ∪ ∩ − × ⋈, composable.
- s35 R={(a1,101),(a2,102),(a2,103),(a3,104)}; σ_{a_id='a2'}(R)={(a2,102),(a2,103)}; σ_{a_id='a2'∧b_id>102}(R)={(a2,103)}.
- s36 π_{b_id−100,a_id}(σ_{a_id='a2'}(R)) = {(2,a2),(3,a2)}; SQL equivalent uses SELECT DISTINCT.
- s37–40 R={(a1,101),(a2,102),(a3,103)}, S={(a3,103),(a4,104),(a5,105)}: R∪S = 5 tuples; R∩S={(a3,103)}; R−S={(a1,101),(a2,102)}; R×S = 9 tuples (R.a_id,R.b_id,S.a_id,S.b_id). SQL: UNION / INTERSECT / EXCEPT / CROSS JOIN.
- s41 Join: S(a_id,b_id,val)={(a3,103,XXX),(a4,104,YYY),(a5,105,ZZZ)}; R⋈S={(a3,103,XXX)}; NATURAL JOIN / JOIN USING / JOIN ON.
- s42 Extended: ρ rename, T←R assignment (WITH), δ duplicate elimination (DISTINCT), γ_{G;f(A)→B} aggregation (GROUP BY), τ_{A↑,B↓} sorting (ORDER BY).
- s43 σ_{b_id=102}(R⋈S) vs R⋈σ_{b_id=102}(S): RA fixes an order of steps; declarative SQL leaves the strategy to the DBMS. s44 SQL is the de-facto standard. s46–52 document & vector data models.

## Lecture 3 (`lecture3-1.pdf`) — Database storage (verified)
- s5 Disk-based architecture: primary storage is non-volatile disk; DBMS moves data between volatile & non-volatile. s6 hierarchy CPU regs → caches → DRAM | SSD → HDD → network storage (faster/smaller/expensive ↔ slower/larger/cheaper; volatile above the line, non-volatile below).
- s7 latencies: L1 1ns, L2 4ns, DRAM 100ns, SSD 16,000ns, HDD 2,000,000ns, network ~50,000,000ns, tape 1,000,000,000ns.
- s8 sequential ≫ random on non-volatile storage; allocate multiple pages at once = extent. s9 goals: manage DB larger than memory, avoid stalls, maximize sequential access.
- s10 Disk-oriented DBMS (execution engine → buffer pool → database file pages; get page #2 → pointer; Lecture 3 = page layout, Lecture 4 = buffer pool).
- s11 Problem #1 representing DB in files; Problem #2 moving data between memory and disk.
- s12 DB = one or more files in proprietary format; OS knows nothing about contents. s13 storage manager: files as collection of pages, tracks reads/writes & free space.
- s14 Page = fixed-size block; may hold tuples, metadata, indexes, log records; most systems don't mix page types; page ID + indirection layer to physical location.
- s15 Three notions of page: hardware (usually 4KB, largest failsafe write), OS (4KB; x64 2MB/1GB), database (512B–32KB). Read-only-specialised DBMSs use larger pages.
- s16 heap / tree / sorted (ISAM) / hashing file organisations. s17 Heap file = unordered pages; create/get/write/delete/iterate; Get Page #23 via page directory (file location + page# × page size). s18 page directory: one entry per object, in sync with data pages, free space per page, free/empty page list, page type.
- s20 Page header: page size, checksum, DBMS version, transaction visibility, compression/encoding metadata, schema info, data summary/sketches; Oracle = self-contained pages.
- s21 Layouts: tuple-oriented, log-structured, index-organized. s22 strawman (num tuples + append): problems with delete and variable-length.
- s23 Slotted pages: slot array maps slots → tuple start offsets; header tracks # used slots and offset of the last used slot's start; slot array grows from the front, tuple data from the end; deleting tuple #3 frees its slot (later frames show compaction/reuse).
- s24 Record ID = file id, page id, slot #; Postgres CTID 6 bytes, SQLite ROWID 8 bytes (true PK, hidden attribute), SQL Server %%physloc%% 8 bytes, Oracle ROWID 10 bytes; apps must not rely on them.
- s25 Tuple = sequence of bytes (not necessarily contiguous) interpreted by DBMS. s26 tuple header: visibility info, NULL bitmap; no schema metadata stored. s27 attributes in CREATE TABLE order (`foo(a INT PK, b INT NOT NULL, c INT, d DOUBLE, e FLOAT)`).
- s28 Physical denormalization (pre-join foo+bar tuples in the same page): fewer I/Os, costlier updates; IBM System R; NoSQL.
- s29 Insert: page directory → page with free slot → fetch page → slot array. Update via record ID: overwrite if fits, else mark deleted & insert elsewhere.
- s30 Problems: fragmentation, useless disk I/O (whole page for one tuple), random disk I/O.
- s32–34 Log-structured storage: log of PUT/DELETE records with key; MemTable (in-memory tree) → flushed as sorted SSTable (key low→high) to Level #0 → compacted to Level #1 …; GET checks MemTable, then SummaryTable (min/max key per SSTable, key filter per level), levels newest→oldest.
- s35 Compaction (sort-merge, keep newest per key): newer `[DEL key100, PUT key101 a3, PUT key102 b2, PUT key103 c1]` + older `[PUT key101 a2, PUT key102 b1, DEL key103, PUT key104 d2]` → `[DEL key100, PUT key101 a3, PUT key102 b2, PUT key103 c1, PUT key104 d2]`.
- s36 Downsides: write amplification, expensive compaction (RocksDB popularised LSM).
- s37–38 Index-organized storage: tuples stored as values in the index (B+Tree leaf with sorted key+offset array); SQLite, MySQL, Oracle, SQL Server; **B+Tree pays maintenance upfront, LSM pays later**.
- s23 (frames p44–49) slotted page: delete tuple #3 → its space is reclaimed by moving tuple #4 next to the others; the slot array entry for #4 is updated, so its record ID (page, slot) does not change.
- s39 catalogs describe the tuple layout. s40 `foo(id INT PK, value BIGINT)` → byte array header|id|value; `reinterpret_cast<int32_t*>(address)`.
- s41 Word alignment: `foo(id INT 32b, cdate TIMESTAMP 64b, color CHAR(2) 16b, zipcode INT 32b)` with 64-bit words: unaligned cdate would straddle a word. s42 **padding**: id+pad32 | cdate | color, zipcode, pad → 3 words (192 bits) instead of 144 bits of data. s43 **reordering**: id, zipcode | cdate | color + pad48 → 3 words.
- s44 representations: INTEGER/BIGINT/SMALLINT/TINYINT = C/C++; FLOAT/REAL (IEEE-754) vs NUMERIC/DECIMAL (fixed-point); VARCHAR/VARBINARY/TEXT/BLOB = length header + bytes or pointer to another page; TIME/DATE/TIMESTAMP = 32/64-bit (micro/milli)seconds since Unix epoch.
- s45–46 floats are inexact: `0.1f + 0.2f` printed with %.20f = 0.30000001192092895508 while 0.3 = 0.29999999999999998890. s47–48 NUMERIC/DECIMAL exact, variable-length, slower (Postgres numeric struct).
- s49 NULLs: #1 null-column bitmap in tuple header (most common in row stores); #2 special sentinel value e.g. INT32_MIN (more common in column stores); #3 per-attribute null flag (**don't**: wastes space / breaks alignment).
- s50 Large values: tuple can't exceed a page → overflow pages (Postgres TOAST >2KB, MySQL > ½ page, SQL Server > page); tuple stores size + location; German strings, overflow compression. s51 External files (Oracle BFILE, MS FILESTREAM) — no durability or transaction protection.
- s52–55 Catalogs stored as tables; INFORMATION_SCHEMA; `\d` (Postgres), `DESCRIBE` (MySQL), `.schema` (SQLite).
- s56 Schema changes: ADD COLUMN — NSM copies tuples, DSM just creates a new column segment; DROP COLUMN — NSM copy or mark deprecated, DSM drop + free. s57 CREATE INDEX (scan + catch up concurrent changes) / DROP INDEX (logical, invisible at commit).
- s58 Conclusion: log-structured suits write-heavy workloads (sequential I/O).

## Lecture 2 (`lecture2-1.pdf`) — Modern SQL (verified)
- s4 DML / DDL / DCL; **SQL is based on bags (duplicates), not sets**.
- s6 Example DB: student(sid,name,login,gpa) [table also shows `age`]: (53666,RZA,rza@cs,55,4.0) (53688,Taylor,swift@cs,27,3.9) (53655,Tupac,shakur@cs,25,3.5). enrolled(sid,cid,grade): (53666,15-445,C) (53688,15-721,A) (53688,15-826,B) (53655,15-445,B) (53666,15-721,C). course(cid,name): 15-445 Database Systems, 15-721 Advanced Database Systems, 15-826 Data Mining, 15-799 Special Topics in Databases.
- s7 AVG/MIN/MAX/SUM/COUNT. s8 aggregates (almost) only in SELECT list; COUNT(login)=COUNT(*)=COUNT(1)=COUNT(1+1+1) for `login LIKE '%@cs'`. s9 `SELECT AVG(gpa), COUNT(sid) … LIKE '%@cs'` → 3.8, 3.
- s10 Non-aggregated column next to an aggregate without GROUP BY is undefined (AVG=3.86, e.cid=???); ANY_VALUE(e.cid) is the explicit escape hatch.
- s11 GROUP BY projects tuples into subsets, aggregate per subset. s12 Non-aggregated SELECT columns must appear in GROUP BY.
- s13 HAVING filters on aggregates ("WHERE for GROUP BY"): `HAVING AVG(s.gpa) > 3.9`.
- s15 LIKE: `%` any substring incl. empty, `_` exactly one char. s16 SUBSTRING, UPPER. s17 `||` concat (SQL-92), `+` MSSQL, CONCAT MySQL. s18 dates (varies). s19 SELECT … INTO (new table) · s20 INSERT INTO … (SELECT …).
- s21 ORDER BY col [ASC|DESC], ORDER BY 2 (position), `ORDER BY grade DESC, sid ASC`. s22 FETCH FIRST n ROWS ONLY, OFFSET n ROWS, WITH TIES.
- s23–26 Window functions: FUNC() OVER (PARTITION BY … ORDER BY …); doesn't collapse rows; ROW_NUMBER(), RANK(). s25 `ROW_NUMBER() OVER (PARTITION BY cid)` → 15-445:{53666→1,53655→2}, 15-721:{53688→1,53666→2}, 15-826:{53688→1}.
- s27 Second-highest grade per course: subquery with `RANK() OVER (PARTITION BY cid ORDER BY grade ASC) AS rank` then `WHERE ranking.rank = 2` (letter grades: 'A' < 'B' alphabetically = better first).
- s28 Nested queries in WHERE / SELECT / ORDER BY. s29 `sid IN (SELECT sid FROM enrolled WHERE cid='15-445')`. s30 ALL / ANY / IN (= `=ANY`) / EXISTS. s31 `sid = ANY(…)`.
- s32 `SELECT MAX(e.sid), s.name FROM enrolled e, student s WHERE e.sid=s.sid` ✗ (not SQL-92; runs in SQLite only). s33 correct: `WHERE sid = (SELECT MAX(sid) FROM enrolled)` → slide result shows "53688 Bieber" (**name inconsistent with s6, where 53688 = Taylor**).
- s34 `NOT EXISTS (SELECT * FROM enrolled WHERE course.cid = enrolled.cid)` → 15-799 Special Topics in Databases (correlated subquery).
- s35–36 LATERAL: per-course COUNT and AVG(gpa) → 15-445 (2, 3.75), 15-721 (2, 3.95), 15-826 (1, 3.9), 15-799 (0, null).
- s37–39 CTEs: `WITH cteName AS (…) SELECT … FROM cteName`; column aliases `WITH cteName (col1,col2) AS (SELECT 1,2)`; highest enrolled id via `WITH cteSource (maxId) AS (SELECT MAX(sid) FROM enrolled) SELECT name FROM student, cteSource WHERE student.sid = cteSource.maxId`.
- s40 identifiers are case-insensitive. s41 compute the answer as a single SQL statement.

## Lecture 4 storage-model slides (verified)
- s4 OLTP (small reads/updates) / OLAP (complex, read lots, aggregates) / HTAP. s5 chart: OLTP = simple + write-heavy, OLAP = complex + read-heavy. s6 Wikipedia schema useracct/pages/revisions.
- s7 Relational model doesn't require a tuple's attributes to be stored together. s10 storage models NSM, DSM, PAX.
- s11 NSM = row store; ideal for OLTP (individual entities, many writes); page = multiple of 4KB. s12 NSM slotted page, record ID (page#, slot#).
- s13 NSM OLTP example: `SELECT * FROM useracct WHERE userName=? AND userPass=?` → index → one page has the whole tuple; INSERT writes one contiguous tuple.
- s14 NSM OLAP example: `SELECT COUNT(U.lastLogin), EXTRACT(month FROM U.lastLogin) AS month FROM useracct AS U WHERE U.hostname LIKE '%.gov' GROUP BY …` → reads whole pages but needs only hostname+lastLogin → "Useless Data!".
- s15 NSM: + fast insert/update/delete, + whole-tuple queries, + index-organized clustering; − poor for scanning large portions / subset of attributes, − poor memory locality, − multiple value domains per page hurt compression.
- s16 DSM = column store; ideal for OLAP read-only scans of a subset of attributes; DBMS combines/splits tuple's attributes on read/write. s17 separate pages per attribute with header + null bitmap; fixed-length arrays; tuple = offset.
- s18 DSM OLAP example: same query reads only hostname and lastLogin columns.
- s19 Tuple identification: fixed-length offsets (preferred) vs embedded tuple IDs ("Don't do this!"). s20 var-length → dictionary compression to fixed-length codes.
- s21 DSM: + less wasted I/O, + locality/cache reuse, + better compression; − slow point queries, inserts, updates, deletes (tuple splitting/stitching).
- s22 OLAP queries almost never access a single column alone → need stitching → want columnar layout that keeps a tuple's data physically close.
- s23 PAX (Partition Attributes Across) = hybrid: vertically partitions attributes *within a page*; Parquet, ORC, Arrow. s24 row groups (horizontal) → column chunks (vertical); global metadata directory in the footer (immutable files); each row group has its own header. Parquet: row groups default 128MB, pages default 1MB, metadata min/max/count.
- s25 compression trade-off speed vs ratio. s26 goals: fixed-length values, late materialization, lossless. s27 granularity: block / tuple (NSM only) / attribute / column (DSM only). s28 naïve (LZ4, Snappy, Zstd…). s29 InnoDB: compressed pages [1,2,4,8]KB + mod log; reads decompress into 16KB page. s30 must decompress before reading. s31 ideal: operate on compressed data (`name='Andy'` → `name=XX`).
- s45 Conclusion: OLTP → row store, OLAP → column store; dictionary encoding most useful (no pre-sorting).

## Lecture 4 (`lecture4-1.pdf`) — compression & buffer pool (verified from rendered slides)
- s36 Bit packing: int32 `[13,191,56,92,81,120,231,172]` 256 bits → 8×8 bits = 64 bits.
- s37 Mostly encoding: `[13,191,99999999,92,81,120,231,172]` → mostly8 + exception table (offset 3 → 99999999): 8×8 + 16 + 32 = 112 bits.
- s39 Bitmap: isDead `Y Y Y N Y N Y Y` (ids 1,2,3,4,6,7,8,9): original 8×8 = 64 bits → Y bitmap `11101011`, N bitmap `00010100`; 2×8 + 8×2 = 32 bits.
- s35 RLE: same column → triplets (value, offset, length): `(Y,0,3) (N,3,1) (Y,4,1) (N,5,1) (Y,6,2)`.
- s41 Delta: time `12:00..12:04`, temp `99.5 99.4 99.5 99.6 99.4`; 5×64 = 320 bits → `12:00 +1 +1 +1 +1` = 64 + 4×16 = 128 bits → +RLE `12:00 (+1,4)` = 64 + 2×16 = 96 bits. Frame-of-reference = use global minimum as base.
- s43–44 Order-preserving dictionary: Andrea=10, Andy=20, Jignesh=30, Mr.Pickles=40; `LIKE 'And%'` → `BETWEEN 10 AND 20`; `SELECT name … LIKE 'And%'` still scans column; `SELECT DISTINCT name …` only needs dictionary.
- s51 Buffer pool = array of fixed-size frames; dirty pages not written immediately (write-back cache).
- s52 Page table (fixed-size hash table, latched) + per-page dirty flag, pin/reference counter, access tracking.
- s53 Locks vs latches · s54 page table vs page directory.
- s60 LRU: evict oldest timestamp. s61 CLOCK: ref bit; hand sweeps: 1→0, 0→evict.
- s62–63 Sequential flooding: Q1 point query (page0), Q2 `AVG(val)` scan page0..page5, 3 frames → page0 evicted, Q3 needs page0 again.
- s64 LRU-K (oldest K-th access; keep history of evicted pages). s65 MySQL approx LRU-K: young/old lists; new page → head of old list; re-access → head of young list.
- s66 Localization (Postgres ring buffer) · s67 priority hints · s68 dirty pages (clean = drop; dirty = write back) · s69 background writing (not before log records).
- s72 O_DIRECT · s73 fsync EIO problem · s75–76 multiple buffer pools (object id / hash page id) · s77–78 prefetching (sequential & index) · s79–80 scan sharing (LIMIT nondeterminism) · s81 buffer pool bypass.

## Lecture 5 (`lecture5-1.pdf`) — hash tables
- s6 O(1) avg / O(n) worst · s8 unrealistic assumptions · s9 hash function vs hashing scheme trade-offs · s10–11 hash functions (no crypto; xxHash state of the art) + 5 desired properties.
- s13–14 Linear probing (one table, scan to next free slot; resize ×2 at load factor). s15 inline fixed-length vs hash+RecordId for var-length.
- s16 Delete by movement (expensive, no DBMS does it) · s17 tombstones (reuse slot on insert; lookups continue past them; GC).
- s18 Non-unique keys: value lists vs redundant keys (most systems).
- s20–21 Cuckoo (one table, hash1/hash2): A→h1=2 (h2=5); B: h1=2 taken → h2=0; C: h1=2, h2=0 both taken → C takes slot0, B moves to h1(B)=2 evicting A → A to h2(A)=5. Final: slot0 C, slot2 B, slot5 A. Lookups check ≤2 slots → O(1).
- s23–24 Chained hashing (bucket chains; filters on bucket pointers).
- s25–26 Extendible hashing: global depth 2, directory 00/01/10/11, **uses leading bits**. Buckets: {00010…,01110…} local 1; {10101…,10011…} local 2; {11010…} local 2; capacity 3. Put B=10111… fills bucket "10"; Put C=10100… overflows → global depth 3, split into "100" {10011…} and "101" {10101…,10111…}, both local 3; C → "101".
- s27–28 Linear hashing: buckets 0{8,20} 1{5,9,13} 2{6} 3{7,11}, cap 3, h1=key%4, split pointer=0. Put 17 → bucket1 full → overflow page {17}; split **bucket 0** (at pointer, not the overflowing one) with h2=key%8: 8 stays, 20 → new bucket 4; pointer → 1. Get 20: h1=0 < pointer → h2=4. Get 9: h1=1 ≥ pointer → bucket 1.
- s29 resizing: pointer reaches end → drop h1, reset pointer. s30 deletes: delete 20 empties bucket 4 → remove it, pointer moves back; put 21 → bucket 1 overflow {17,21}.
- s31 Hash tables usually not the table index (Postgres default index = BTREE).

## Lecture 6 (`lecture6.pdf`) — B+Trees
- s6 Properties: perfectly balanced; non-root nodes ≥ half full (m/2−1 ≤ #keys ≤ m−1); inner node with k keys has k+1 children; O(log_m n).
- s7 Example tree; sibling pointers; inner `<node*>|<key>|…`, leaf `<key>|<value>|…`. s9 leaf: level, slots, prev, next. s10 leaf values: record IDs vs tuple data (index-organized; secondary index stores PK). s11 B-Tree vs B+Tree.
- s12 Insert: leaf split → **copy up** middle key; inner split → **push up** middle key.
- s13 (max 3 keys): root [4,12], leaves [1,3] [5,9,10] [12,13]; insert 6 → [5,6] [9,10], copy up 9 → root [4,9,12]; insert 8 → [5,6,8].
- s14–15 (max 4 keys): root [5,9,13,19]; leaves [1,3] [5,7] [9,11] [13,14,15] [20,21,23]; insert 17 → [13,14,15,17]; insert 16 → leaf split [13,14,15] | [16,17] copy up 16; root full → split [5,9] (13 pushed up) [16,19]; new root [13].
- s16 Delete: if under-full try redistribution from sibling with same parent, else merge, then delete separator from parent.
- s17 (max 3): root [4,9]; leaves [1,3] [5,6] [9,…]; delete 6 → [5] under-full → borrow from rich right sibling → parent separator updated.
- s18 (max 4): root [13]; inner [5,9] & [17,21]; leaves [1,3] [5,7] [9,11] [13,15] [17,19,20] [21,23]; delete 15 → [13] borrows 17 → [13,17] [19,20], parent [19,21].
- s19 delete 19 → [20] under-full, no rich sibling → merge with [21,23] → [20,21,23], parent [19] under-full → pull down 13 and merge with [5,9] → root [5,9,13,19]; tree shrinks.
- s20 Composite index <a,b,c>: prefix (a,b,c), (a,b) supported; (b), (c) rarely. s21 selection conditions (prefix vs (*,1) skip scan).
- s22–24 Duplicates: append record ID / overflow leaf nodes. s25–26 clustered index (scan leaves in page order). s27 index-scan page sorting (sort RIDs by page id → read each page once).
- s29 node size HDD ~1MB, SSD ~10KB, memory ~512B · s30 merge threshold (avg occupancy 69%) · s31 variable-length keys · s32 intra-node search (linear/SIMD, binary, interpolation: offset (8−4)·7/(10−4)=4).
- s34 prefix compression (rob|bed,bing,ot) · s35 deduplication · s36 suffix truncation · s37 pointer swizzling · s38 bulk insert (sort then build bottom-up) · s40 write-optimized B+Tree (Bε-tree / fractal tree buffers).

## Lecture 7 (`lecture7.pdf`) — indexes & filters
- s2 Index (where) vs filter (whether — likely). s4–5 Bloom filter, 8 bits, k=2: insert RZA (2222%8=6, 4444%8=4); insert GZA (sets bits 1,3); lookup RZA → TRUE; Raekwon (3333%8=5, 8899%8=3) → bit5=0 → FALSE; ODB (6699%8=3, 9966%8=6) → TRUE = **false positive**. No false negatives.
- s6 Counting Bloom (deletes), Cuckoo filter (fingerprints), SuRF (range).
- s8–13 Skip lists: levels halve; coin flips decide height; search top-down; delete = logical flag then physical removal; pros (no rebalancing, less memory) / cons (poor locality, reverse search hard).
- s14 B+Tree inner keys can't prove absence. s15 Trie: HELLO/HAT/HAVE; O(k); shape independent of insertion order; no rebalancing. s16–17 key span (1-bit span: K10, K25, K31). s18 Radix (Patricia) tree: compress single-child chains; false positives → check tuple. s19 HAIR/HAT/HAVE edits.
- s20–23 Inverted index (term → posting list; Lucene FST; Postgres GIN with pending list). s25–27 Vector indexes (IVFFlat clusters; HNSW graph).
