import { useCallback, useEffect, useState } from 'react';
import { About } from './components/About.tsx';
import { ApplyPage } from './components/ApplyPage.tsx';
import { ChatPanel } from './components/ChatPanel.tsx';
import { Icon } from './components/Icon.tsx';
import { LeadsTable } from './components/LeadsTable.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TopNav } from './components/TopNav.tsx';
import type { Route } from './components/TopNav.tsx';
import { TrackPage } from './components/TrackPage.tsx';
import { useHealth } from './hooks/useHealth.ts';
import { useHistory } from './hooks/useHistory.ts';
import type { HistoryEntry } from './hooks/useHistory.ts';
import { useTheme } from './hooks/useTheme.ts';

const ROUTES: Route[] = ['apply', 'track', 'admin', 'about'];

interface Location {
  route: Route;
  /** #/track/GL-1001 → the application id to prefill */
  param?: string | undefined;
}

function locationFromHash(): Location {
  const [name = '', param] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'applications') return { route: 'admin' }; // old links
  return (ROUTES as string[]).includes(name) ? { route: name as Route, param: param ? decodeURIComponent(param) : undefined } : { route: 'apply' };
}

function useLocation(): [Location, (route: Route, param?: string) => void] {
  const [location, setLocation] = useState<Location>(locationFromHash);
  useEffect(() => {
    const onHash = (): void => setLocation(locationFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((route: Route, param?: string) => {
    window.location.hash = param ? `#/${route}/${encodeURIComponent(param)}` : `#/${route}`;
    setLocation({ route, param });
    window.scrollTo({ top: 0 });
  }, []);
  return [location, go];
}

export default function App() {
  const { theme, setTheme } = useTheme();
  const [{ route, param }, go] = useLocation();
  const health = useHealth();
  const history = useHistory();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [version, setVersion] = useState(0); // bumps when an application is filed, so the admin table refreshes
  const [applyKey, setApplyKey] = useState(0);

  const { add } = history;
  const onFiled = useCallback(
    (entry: HistoryEntry) => {
      add(entry);
      setVersion((v) => v + 1);
    },
    [add],
  );
  const closeChat = useCallback(() => setChatOpen(false), []);

  const newApplication = useCallback(() => {
    setApplyKey((k) => k + 1);
    go('apply');
    setMenuOpen(false);
  }, [go]);

  const track = useCallback(
    (applicationId?: string) => {
      go('track', applicationId);
      setMenuOpen(false);
    },
    [go],
  );

  return (
    <div className="app">
      <div className="bg" aria-hidden="true" />
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Sidebar
        open={menuOpen}
        health={health}
        history={history.entries}
        onClose={() => setMenuOpen(false)}
        onNew={newApplication}
        onOpenHistory={track}
        onClearHistory={history.clear}
      />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <div className="main">
        <TopNav route={route} theme={theme} onNavigate={(r) => go(r)} onSetTheme={setTheme} onOpenMenu={() => setMenuOpen(true)} />
        <main id="main" className="stage" tabIndex={-1}>
          {route === 'apply' && <ApplyPage key={applyKey} onFiled={onFiled} onTrack={track} onRestart={newApplication} />}
          {route === 'track' && <TrackPage initialId={param} />}
          {route === 'admin' && <LeadsTable version={version} />}
          {route === 'about' && <About assistant={health.info?.assistant} storage={health.info?.storage} />}
        </main>
        <footer className="legal">Indicative estimates · final amount decided after physical appraisal · not a promise of approval</footer>
      </div>

      {!chatOpen && (
        <button type="button" className="chat-launcher" onClick={() => setChatOpen(true)} aria-label="Open Loan Assist chat">
          <Icon name="chat" size={22} />
          <span>Ask Loan Assist</span>
        </button>
      )}
      <ChatPanel open={chatOpen} onClose={closeChat} onFiled={onFiled} />
    </div>
  );
}
