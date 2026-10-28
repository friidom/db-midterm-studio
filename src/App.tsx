import { useEffect, useState } from 'react';
import { useProgress, update } from './store';
import { Icon } from './ui/kit';
import { Dashboard, Roadmap, LessonsIndex, ModulePage, LessonPage, Labs, ProgressPage, Settings, Sources } from './ui/pages';
import { Practice, ModuleTest, Exam, Review } from './ui/assess';

const NAV = [
  { href: '#/', icon: 'home', label: 'Dashboard', match: '' },
  { href: '#/roadmap', icon: 'map', label: 'Course roadmap', match: 'roadmap' },
  { href: '#/lessons', icon: 'book', label: 'Lessons', match: 'lessons|lesson|module' },
  { href: '#/practice', icon: 'target', label: 'Practice', match: 'practice|test' },
  { href: '#/labs', icon: 'flask', label: 'Labs & simulators', match: 'labs' },
  { href: '#/exam', icon: 'exam', label: 'Exam mode', match: 'exam' },
  { href: '#/review', icon: 'redo', label: 'Mistakes & review', match: 'review' },
  { href: '#/progress', icon: 'chart', label: 'Progress & stats', match: 'progress' },
  { href: '#/sources', icon: 'info', label: 'Sources & scope', match: 'sources' },
  { href: '#/settings', icon: 'gear', label: 'Settings', match: 'settings' },
];

function useHash() {
  const [h, setH] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const f = () => {
      setH(window.location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  const s = useProgress();
  const hash = useHash();
  const [menu, setMenu] = useState(false);
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  const route = parts[0] ?? '';

  useEffect(() => {
    const root = document.documentElement;
    if (s.settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = s.settings.theme;
  }, [s.settings.theme]);
  useEffect(() => setMenu(false), [hash]);

  let page;
  switch (route) {
    case '':
      page = <Dashboard />;
      break;
    case 'roadmap':
      page = <Roadmap />;
      break;
    case 'lessons':
      page = <LessonsIndex />;
      break;
    case 'module':
      page = <ModulePage id={parts[1]} />;
      break;
    case 'lesson':
      page = <LessonPage key={parts[1]} id={parts[1]} />;
      break;
    case 'practice':
      page = <Practice key={hash} module={parts[1]} skill={params.get('skill') ?? undefined} />;
      break;
    case 'test':
      page = <ModuleTest key={parts[1]} id={parts[1]} />;
      break;
    case 'exam':
      page = <Exam />;
      break;
    case 'review':
      page = <Review />;
      break;
    case 'progress':
      page = <ProgressPage />;
      break;
    case 'labs':
      page = <Labs key={parts[1] ?? ''} name={parts[1]} />;
      break;
    case 'settings':
      page = <Settings />;
      break;
    case 'sources':
      page = <Sources />;
      break;
    default:
      page = (
        <div className="page">
          <h1>Page not found</h1>
          <a href="#/">Back to the dashboard</a>
        </div>
      );
  }

  const dark = s.settings.theme === 'dark' || (s.settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button className="icon-btn" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="menu" />
        </button>
        <a className="brand" href="#/">
          <span className="logo">DB</span> Midterm Studio
        </a>
      </header>
      <nav className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main">
        <a className="brand" href="#/">
          <span className="logo">DB</span>
          <span>
            Midterm Studio
            <small>SOC3020 Databases</small>
          </span>
        </a>
        <ul>
          {NAV.map((n) => {
            const active = n.match === '' ? route === '' : new RegExp(`^(${n.match})$`).test(route);
            return (
              <li key={n.href}>
                <a href={n.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                  <Icon name={n.icon} />
                  {n.label}
                  {n.match === 'review' && Object.keys(s.review).length > 0 && <span className="count">{Object.keys(s.review).length}</span>}
                </a>
              </li>
            );
          })}
        </ul>
        <button
          className="theme-toggle"
          onClick={() => update((st) => ({ ...st, settings: { ...st.settings, theme: dark ? 'light' : 'dark' } }))}
          aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
        >
          <Icon name={dark ? 'sun' : 'moon'} size={16} /> {dark ? 'Light' : 'Dark'} theme
        </button>
      </nav>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <main id="main" className="main" tabIndex={-1}>
        {page}
      </main>
    </div>
  );
}
