import { Icon } from './Icon.tsx';
import type { Theme } from '../hooks/useTheme.ts';

export type Route = 'apply' | 'track' | 'admin' | 'about';

/** The applicant side. The admin panel is a separate area, opened from the top-right corner. */
const LINKS: Array<{ route: Route; label: string }> = [
  { route: 'apply', label: 'Apply' },
  { route: 'track', label: 'Track' },
  { route: 'about', label: 'About' },
];

interface TopNavProps {
  route: Route;
  theme: Theme;
  onNavigate: (route: Route) => void;
  onSetTheme: (theme: Theme) => void;
  onOpenMenu: () => void;
}

export function TopNav({ route, theme, onNavigate, onSetTheme, onOpenMenu }: TopNavProps) {
  const admin = route === 'admin';
  const go = (r: Route) => (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate(r);
  };

  return (
    <header className={`topnav-wrap${admin ? ' is-admin' : ''}`}>
      {admin ? (
        <div className="admin-brand">
          <span className="logo" aria-hidden="true">
            G
          </span>
          <span className="brand-name">
            Gold<span>Loan</span>
          </span>
          <span className="admin-tag">Admin panel</span>
        </div>
      ) : (
        <nav className="topnav" aria-label="Main">
          <button type="button" className="icon-btn only-mobile" onClick={onOpenMenu} aria-label="Open menu">
            <Icon name="menu" size={20} />
          </button>
          {LINKS.map((l) => (
            <a
              key={l.route}
              href={`#/${l.route}`}
              className={route === l.route ? 'active' : ''}
              aria-current={route === l.route ? 'page' : undefined}
              onClick={go(l.route)}
            >
              {l.label}
            </a>
          ))}
        </nav>
      )}

      <div className="topnav-right">
        {admin ? (
          <a href="#/apply" className="top-btn" onClick={go('apply')}>
            <Icon name="back" size={16} />
            <span>Back to portal</span>
          </a>
        ) : (
          <a href="#/admin" className="top-btn" onClick={go('admin')} aria-label="Admin panel" title="Admin panel">
            <Icon name="shield" size={16} />
            <span>Admin</span>
          </a>
        )}
        <div className="theme-switch" role="group" aria-label="Colour theme">
          <button type="button" aria-pressed={theme === 'light'} onClick={() => onSetTheme('light')} title="Gold & white">
            <Icon name="sun" size={16} />
            <span className="visually-hidden">Light theme</span>
          </button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => onSetTheme('dark')} title="Gold & black">
            <Icon name="moon" size={16} />
            <span className="visually-hidden">Dark theme</span>
          </button>
        </div>
      </div>
    </header>
  );
}
