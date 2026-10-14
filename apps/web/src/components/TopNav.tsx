import { Icon } from './Icon.tsx';
import type { Theme } from '../hooks/useTheme.ts';

export type Route = 'apply' | 'track' | 'admin' | 'about';

const LINKS: Array<{ route: Route; label: string }> = [
  { route: 'apply', label: 'Apply' },
  { route: 'track', label: 'Track' },
  { route: 'admin', label: 'Admin' },
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
  return (
    <header className="topnav-wrap">
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
            onClick={(e) => {
              e.preventDefault();
              onNavigate(l.route);
            }}
          >
            {l.label}
          </a>
        ))}
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
      </nav>
    </header>
  );
}
