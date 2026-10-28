import { Fragment, type ReactNode } from 'react';
import type { TableData } from '../lib/types';
import type { ModuleStatus, SkillLevel } from '../lib/progress';

/* ---------- tiny markdown: paragraphs, lists, ### headings, **bold**, *italic*, `code`, [links](#/…) ---------- */
function inline(text: string, keyBase = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const safe = mm[2].startsWith('#/') ? mm[2] : '#/';
      out.push(
        <a key={k} href={safe}>
          {mm[1]}
        </a>,
      );
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Md({ md, className }: { md: string; className?: string }) {
  const blocks = md.trim().split(/\n\s*\n/);
  return (
    <div className={`md ${className ?? ''}`}>
      {blocks.map((b, i) => {
        const lines = b.split('\n').map((l) => l.trimEnd());
        if (lines.every((l) => /^\s*[-•] /.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-•] /, ''), `${i}-${j}`)}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\s*\d+[.)] /.test(l)))
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)] /, ''), `${i}-${j}`)}</li>
              ))}
            </ol>
          );
        if (lines[0].startsWith('### '))
          return (
            <Fragment key={i}>
              <h4>{inline(lines[0].slice(4), `${i}h`)}</h4>
              {lines.length > 1 && <p>{inline(lines.slice(1).join(' '), `${i}p`)}</p>}
            </Fragment>
          );
        return <p key={i}>{inline(lines.join(' '), `${i}`)}</p>;
      })}
    </div>
  );
}

export const Inline = ({ md }: { md: string }) => <>{inline(md, 'in')}</>;

/* ---------- SQL syntax highlighting ---------- */
const SQL_KW =
  /^(SELECT|FROM|WHERE|GROUP|BY|HAVING|ORDER|ASC|DESC|LIMIT|OFFSET|FETCH|FIRST|NEXT|ROWS?|ONLY|WITH|TIES|AS|JOIN|LEFT|RIGHT|INNER|OUTER|NATURAL|CROSS|ON|USING|AND|OR|NOT|IN|EXISTS|ANY|ALL|SOME|UNION|INTERSECT|EXCEPT|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|REFERENCES|NULL|IS|LIKE|BETWEEN|CASE|WHEN|THEN|ELSE|END|OVER|PARTITION|LATERAL|TEMPORARY|INT|INTEGER|BIGINT|VARCHAR|TEXT|TIMESTAMP|CHAR|DOUBLE|FLOAT|UNIQUE)$/i;
const SQL_FN = /^(COUNT|SUM|AVG|MIN|MAX|ROW_NUMBER|RANK|SUBSTRING|UPPER|LOWER|CONCAT|EXTRACT|COALESCE|ANY_VALUE)$/i;

export function highlightSql(code: string): ReactNode[] {
  const parts = code.split(/('(?:[^']|'')*'|--[^\n]*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("'")) return <span key={i} className="tk-str">{p}</span>;
    if (p.startsWith('--')) return <span key={i} className="tk-com">{p}</span>;
    const segs = p.split(/(\b\w+\b)/g);
    return (
      <Fragment key={i}>
        {segs.map((s, j) =>
          SQL_KW.test(s) ? (
            <span key={j} className="tk-kw">{s}</span>
          ) : SQL_FN.test(s) ? (
            <span key={j} className="tk-fn">{s}</span>
          ) : /^\d+(\.\d+)?$/.test(s) ? (
            <span key={j} className="tk-num">{s}</span>
          ) : (
            s
          ),
        )}
      </Fragment>
    );
  });
}

export function Code({ code, lang = 'sql', title }: { code: string; lang?: string; title?: string }) {
  return (
    <figure className="code">
      {title && <figcaption>{title}</figcaption>}
      <pre>
        <code>{lang === 'sql' ? highlightSql(code) : code}</code>
      </pre>
    </figure>
  );
}

/* ---------- tables ---------- */
export function RelTable({ t, compact }: { t: TableData; compact?: boolean }) {
  return (
    <div className={`rel ${compact ? 'compact' : ''}`}>
      {t.title && <div className="rel-title">{t.title}</div>}
      <div className="rel-scroll">
        <table>
          <thead>
            <tr>
              {t.cols.map((c, i) => (
                <th key={i} className={t.hlCols?.includes(i) ? 'hl' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, t.cols.length)} className="empty">
                  (no rows)
                </td>
              </tr>
            )}
            {t.rows.map((r, i) => (
              <tr key={i} className={t.hl?.includes(i) ? 'hl' : ''}>
                {r.map((v, j) => (
                  <td key={j} className={v === null ? 'null' : typeof v === 'number' ? 'num' : ''}>
                    {v === null ? 'NULL' : typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.note && <div className="rel-note">{t.note}</div>}
    </div>
  );
}

/* ---------- icons ---------- */
const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zm0 14a2 2 0 0 1 2-2h13',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  flask: 'M9 3h6M10 3v6L4.5 18.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3M7 15h10',
  exam: 'M9 4h6l1 2h3v15H5V6h3zm0 8l2 2 4-4',
  redo: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5v-5m0-3h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  lock: 'M6 11h12v10H6zm2 0V7a4 4 0 0 1 8 0v4',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  bulb: 'M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  warn: 'M12 3l10 18H2zm0 7v5m0 3h.01',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 3',
  play: 'M7 4l13 8-13 8z',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  layers: 'M12 3l9 5-9 5-9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
};

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

/* ---------- small components ---------- */
export function Bar({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'good' | 'warn' | 'bad'; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <span className={`bar-fill ${tone}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Ring({ value, size = 64, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring" role="img" aria-label={`${label ?? ''} ${Math.round(value * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

export const STATUS_TEXT: Record<ModuleStatus, string> = {
  locked: 'Locked',
  available: 'Available',
  'in-progress': 'In progress',
  'needs-review': 'Needs review',
  mastered: 'Mastered',
};

export function StatusPill({ status }: { status: ModuleStatus }) {
  return (
    <span className={`pill st-${status}`}>
      {status === 'locked' && <Icon name="lock" size={12} />}
      {status === 'mastered' && <Icon name="check" size={12} />}
      {STATUS_TEXT[status]}
    </span>
  );
}

export const LEVEL_TEXT: Record<SkillLevel, string> = { new: 'Not started', learning: 'Learning', developing: 'Developing', strong: 'Strong' };

export function LevelPill({ level }: { level: SkillLevel }) {
  return <span className={`pill lv-${level}`}>{LEVEL_TEXT[level]}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name="info" size={22} />
      <div>
        <strong>{title}</strong>
        {children && <div className="muted">{children}</div>}
      </div>
    </div>
  );
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
