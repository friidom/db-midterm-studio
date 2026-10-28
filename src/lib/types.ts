// Content model. Lessons and questions live in src/content/* as plain data.

export interface SourceRef {
  lecture: string; // "Lecture 4" | "Syllabus"
  file: string; // "lecture4-1.pdf"
  slides: string; // slide numbers printed in the slide footer, e.g. "11–15"
}

/** Where a piece of content comes from — shown to the learner. */
export type Provenance = 'slides' | 'explanatory' | 'supplementary';

export interface TableData {
  title?: string;
  cols: string[];
  rows: (string | number | null)[][];
  hl?: number[]; // highlighted row indexes
  hlCols?: number[];
  note?: string;
}

export interface Step {
  md: string;
  block?: Block;
}

export interface Concept {
  title: string;
  intuition: string;
  why: string;
  definition: string;
  example?: Block[];
  walkthrough?: { title: string; steps: Step[] };
  mistakes?: { wrong: string; right: string }[];
  check?: string; // question id
}

export type WidgetName =
  | 'sql'
  | 'ra'
  | 'buffer'
  | 'probe'
  | 'cuckoo'
  | 'exthash'
  | 'linhash'
  | 'bptree'
  | 'bloom'
  | 'layout'
  | 'slotted'
  | 'compression'
  | 'align'
  | 'lsm';

export type Block =
  | { k: 'md'; md: string }
  | { k: 'callout'; tone: 'tip' | 'warn' | 'exam' | 'info' | 'supp'; title?: string; md: string }
  | { k: 'table'; t: TableData }
  | { k: 'tables'; ts: TableData[]; caption?: string }
  | { k: 'code'; code: string; lang?: 'sql' | 'text' | 'cpp'; title?: string }
  | { k: 'concept'; c: Concept }
  | { k: 'steps'; title: string; steps: Step[] }
  | { k: 'check'; q: string }
  | { k: 'widget'; w: WidgetName; props?: Record<string, unknown> }
  | { k: 'compare'; title?: string; cols: string[]; rows: string[][] }
  | { k: 'diagram'; d: string; caption?: string }; // monospace ASCII diagram

export interface Lesson {
  id: string;
  module: string;
  title: string;
  minutes: number;
  summary: string;
  objectives: string[];
  sources: SourceRef[];
  provenance?: Provenance; // default: slides
  provenanceNote?: string;
  keyTerms?: { term: string; def: string }[];
  blocks: Block[];
}

export interface ModuleDef {
  id: string;
  num: number;
  title: string;
  short: string;
  week: string;
  lectures: string;
  blurb: string;
  prereqs: string[];
  skills: { id: string; label: string; lesson?: string }[];
  test: { size: number; pass: number; require?: { skill: string; min: number; label: string }[] };
  examWeight: number;
  objectives: string[];
  formulas?: { label: string; md: string }[];
  examTips?: string[];
}

export type QuestionUse = 'check' | 'practice' | 'test' | 'exam';

interface QBase {
  id: string;
  module: string;
  skills: string[];
  level: 1 | 2 | 3;
  prompt: string;
  context?: Block[];
  hints?: string[];
  explain: string;
  source?: string;
  follow?: string; // id of a simpler follow-up question
  use?: QuestionUse[]; // default: practice + test + exam
  generated?: boolean;
}

export type Question = QBase &
  (
    | { type: 'mcq'; options: string[]; answer: number; why?: (string | undefined)[] }
    | { type: 'multi'; options: string[]; answer: number[]; why?: (string | undefined)[] }
    | { type: 'num'; answer: number; tol?: number; unit?: string }
    | { type: 'text'; answer: string[]; mode?: 'exact' | 'list' | 'set'; placeholder?: string }
    | { type: 'order'; items: string[] }
    | { type: 'sql'; db: string; solution: string; ordered?: boolean; starter?: string }
    | { type: 'ra'; db: string; solution: string }
    | { type: 'trace'; trace: TraceSpec }
  );

export type QType = Question['type'];

/** Interactive step-by-step prediction exercises driven by the simulators. */
export type TraceSpec =
  | { sim: 'buffer'; policy: 'LRU' | 'MRU' | 'CLOCK' | 'LRU2'; frames: number; refs: string; newRef?: 0 | 1 }
  | { sim: 'probe'; size: number; ops: string } // "+A:2 +B:0 ?C:2 -C:2"
  | { sim: 'exthash'; cap: number; global: number; start?: string; ops: string }
  | { sim: 'linhash'; n0: number; cap: number; start?: number[][]; ops: string }
  | { sim: 'bptree'; maxKeys: number; start?: string; ops: string }
  | { sim: 'bloom'; m: number; ops: string };

/** A learner response, serialisable. */
export type Response =
  | { type: 'mcq'; choice: number }
  | { type: 'multi'; choices: number[] }
  | { type: 'num'; value: string }
  | { type: 'text'; value: string }
  | { type: 'order'; order: string[] }
  | { type: 'sql'; query: string }
  | { type: 'ra'; expr: string }
  | { type: 'trace'; score: number };

export interface CheckResult {
  correct: boolean;
  score: number; // 0..1
  feedback?: string; // misconception-specific feedback
  expected?: string; // human-readable correct answer
}
