import type { RelDb, Val } from '../lib/ra';

export interface DsTable {
  name: string;
  cols: { name: string; type: 'INTEGER' | 'TEXT' | 'REAL' }[];
  rows: Val[][];
}
export interface Dataset {
  id: string;
  title: string;
  source: string;
  note?: string;
  tables: DsTable[];
}

const I = 'INTEGER' as const;
const T = 'TEXT' as const;
const R = 'REAL' as const;

export const DATASETS: Dataset[] = [
  {
    id: 'lecture2',
    title: 'Lecture 2 example database (student / enrolled / course)',
    source: 'Lecture 2, slide 6 (lecture2-1.pdf)',
    tables: [
      {
        name: 'student',
        cols: [{ name: 'sid', type: I }, { name: 'name', type: T }, { name: 'login', type: T }, { name: 'age', type: I }, { name: 'gpa', type: R }],
        rows: [
          [53666, 'RZA', 'rza@cs', 55, 4.0],
          [53688, 'Taylor', 'swift@cs', 27, 3.9],
          [53655, 'Tupac', 'shakur@cs', 25, 3.5],
        ],
      },
      {
        name: 'enrolled',
        cols: [{ name: 'sid', type: I }, { name: 'cid', type: T }, { name: 'grade', type: T }],
        rows: [
          [53666, '15-445', 'C'],
          [53688, '15-721', 'A'],
          [53688, '15-826', 'B'],
          [53655, '15-445', 'B'],
          [53666, '15-721', 'C'],
        ],
      },
      {
        name: 'course',
        cols: [{ name: 'cid', type: T }, { name: 'name', type: T }],
        rows: [
          ['15-445', 'Database Systems'],
          ['15-721', 'Advanced Database Systems'],
          ['15-826', 'Data Mining'],
          ['15-799', 'Special Topics in Databases'],
        ],
      },
    ],
  },
  {
    id: 'campus',
    title: 'Campus practice database (adds NULLs, duplicates and empty groups)',
    source: 'Practice dataset written for this app — same shape as Lecture 2’s example, extended for edge cases.',
    note: 'Dana has gpa = NULL and an enrollment with grade = NULL (course still in progress). Two students are named Kim. Lola has no enrollments; ST210 has no students.',
    tables: [
      {
        name: 'student',
        cols: [{ name: 'sid', type: I }, { name: 'name', type: T }, { name: 'login', type: T }, { name: 'age', type: I }, { name: 'gpa', type: R }, { name: 'major', type: T }],
        rows: [
          [101, 'Aziz', 'aziz@cs', 20, 3.6, 'CS'],
          [102, 'Bella', 'bella@ee', 21, 3.1, 'EE'],
          [103, 'Chen', 'chen@cs', 22, 3.9, 'CS'],
          [104, 'Dana', 'dana@math', 19, null, 'MATH'],
          [105, 'Kim', 'kim1@cs', 23, 2.8, 'CS'],
          [106, 'Kim', 'kim2@ee', 20, 3.4, 'EE'],
          [107, 'Lola', 'lola@cs', 24, 3.9, null],
        ],
      },
      {
        name: 'course',
        cols: [{ name: 'cid', type: T }, { name: 'title', type: T }, { name: 'dept', type: T }, { name: 'credits', type: I }],
        rows: [
          ['DB101', 'Database Systems', 'CS', 3],
          ['DB201', 'Advanced Databases', 'CS', 3],
          ['ML150', 'Machine Learning', 'CS', 4],
          ['SP110', 'Signal Processing', 'EE', 3],
          ['ST210', 'Statistics', 'MATH', 3],
        ],
      },
      {
        name: 'enrolled',
        cols: [{ name: 'sid', type: I }, { name: 'cid', type: T }, { name: 'grade', type: T }, { name: 'score', type: I }],
        rows: [
          [101, 'DB101', 'A', 92],
          [101, 'ML150', 'B', 81],
          [102, 'DB101', 'B', 85],
          [102, 'SP110', 'A', 90],
          [103, 'DB101', 'A', 95],
          [103, 'DB201', 'A', 93],
          [103, 'ML150', 'A', 90],
          [104, 'DB101', null, null],
          [105, 'DB101', 'C', 71],
          [105, 'SP110', 'B', 80],
          [106, 'ML150', 'C', 74],
        ],
      },
    ],
  },
  {
    id: 'music',
    title: 'Lecture 1 music store (Artist / Album / ArtistAlbum)',
    source: 'Lecture 1, slide 31 (lecture1-1.pdf)',
    tables: [
      {
        name: 'Artist',
        cols: [{ name: 'id', type: I }, { name: 'name', type: T }, { name: 'year', type: I }, { name: 'country', type: T }],
        rows: [
          [101, 'Wu-Tang Clan', 1992, 'USA'],
          [102, 'Notorious BIG', 1992, 'USA'],
          [103, 'GZA', 1990, 'USA'],
        ],
      },
      {
        name: 'Album',
        cols: [{ name: 'id', type: I }, { name: 'name', type: T }, { name: 'year', type: I }],
        rows: [
          [11, 'Enter the Wu-Tang', 1993],
          [22, 'St.Ides Mix Tape', 1994],
          [33, 'Liquid Swords', 1995],
        ],
      },
      {
        name: 'ArtistAlbum',
        cols: [{ name: 'artist_id', type: I }, { name: 'album_id', type: I }],
        rows: [
          [101, 11],
          [101, 22],
          [103, 22],
          [102, 22],
        ],
      },
    ],
  },
  {
    id: 'rs',
    title: 'R and S (set operations & product)',
    source: 'Lecture 1, slides 37–40',
    tables: [
      { name: 'R', cols: [{ name: 'a_id', type: T }, { name: 'b_id', type: I }], rows: [['a1', 101], ['a2', 102], ['a3', 103]] },
      { name: 'S', cols: [{ name: 'a_id', type: T }, { name: 'b_id', type: I }], rows: [['a3', 103], ['a4', 104], ['a5', 105]] },
    ],
  },
  {
    id: 'rsj',
    title: 'R and S(a_id, b_id, val) (join)',
    source: 'Lecture 1, slide 41',
    tables: [
      { name: 'R', cols: [{ name: 'a_id', type: T }, { name: 'b_id', type: I }], rows: [['a1', 101], ['a2', 102], ['a3', 103]] },
      { name: 'S', cols: [{ name: 'a_id', type: T }, { name: 'b_id', type: I }, { name: 'val', type: T }], rows: [['a3', 103, 'XXX'], ['a4', 104, 'YYY'], ['a5', 105, 'ZZZ']] },
    ],
  },
  {
    id: 'r35',
    title: 'R (selection & projection)',
    source: 'Lecture 1, slides 35–36',
    tables: [{ name: 'R', cols: [{ name: 'a_id', type: T }, { name: 'b_id', type: I }], rows: [['a1', 101], ['a2', 102], ['a2', 103], ['a3', 104]] }],
  },
];

export const dataset = (id: string): Dataset => {
  const d = DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown dataset ${id}`);
  return d;
};

export function relDb(id: string): RelDb {
  return Object.fromEntries(dataset(id).tables.map((t) => [t.name, { cols: t.cols.map((c) => c.name), rows: t.rows }]));
}

const lit = (v: Val) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function datasetSql(id: string): string {
  return dataset(id)
    .tables.map(
      (t) =>
        `CREATE TABLE ${t.name} (${t.cols.map((c) => `${c.name} ${c.type}`).join(', ')});\n` +
        t.rows.map((r) => `INSERT INTO ${t.name} VALUES (${r.map(lit).join(', ')});`).join('\n'),
    )
    .join('\n');
}
