# DB Midterm Studio

Interactive, mastery-based study app for the **SOC3020 Databases midterm** (Week 7, covering Weeks 1–6), built from the PDFs in this folder.

## Run it

```bash
npm install        # once
npm run dev        # http://localhost:5173
```

Other commands: `npm test` (unit tests), `npm run typecheck`, `npm run build && npm run preview` (production build).

Everything runs locally in the browser — no backend, no API keys. Progress is saved in this browser's localStorage (Settings → Reset).

## What's inside

- 8 modules / 35 lessons following the syllabus order (relational algebra → SQL → storage → storage models & compression → buffer pool → hash tables → B+Trees → filters). Every lesson cites its source slides.
- 139 hand-written questions (MCQ, multi-select, numeric, short answer, ordering, real SQL, relational algebra, step-by-step traces) plus unlimited generated trace questions.
- Real SQL engine (SQLite via sql.js), relational algebra engine, and simulators for buffer pools (LRU/CLOCK/MRU/LRU-K), linear probing, cuckoo, extendible and linear hashing, B+Trees, Bloom filters, slotted pages, NSM/DSM/PAX layouts, compression, word alignment and LSM compaction.
- Mastery: modules unlock only after the prerequisite's module test is passed; lesson completion (quick checks) is tracked separately from mastery.

## Sources

`docs/SOURCE_NOTES.md` records what was extracted from each lecture (by slide number), the midterm scope from the syllabus, and the gaps/discrepancies found. The in-app "Sources & scope" page summarises them.
