import { useEffect, useState } from 'react';
import { formatDayMonth, formatPaise, formatRupees } from '@gold/shared/format';
import { api } from '../api/client.ts';
import type { Health } from '../hooks/useHealth.ts';
import type { HistoryEntry } from '../hooks/useHistory.ts';
import { Icon } from './Icon.tsx';

interface SidebarProps {
  open: boolean;
  health: Health;
  history: HistoryEntry[];
  onClose: () => void;
  onNew: () => void;
  onOpenHistory: (applicationId: string) => void;
  onClearHistory: () => void;
}

export function Sidebar({ open, health, history, onClose, onNew, onOpenHistory, onClearHistory }: SidebarProps) {
  const [rate, setRate] = useState<string | null>(null);

  useEffect(() => {
    if (!health.online) return;
    api
      .goldRate()
      .then((r) => setRate(formatPaise(r.ratePerGram24kPaise)))
      .catch(() => setRate(null));
  }, [health.online]);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Sidebar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          G
        </span>
        <span className="brand-name">
          Gold<span>Loan</span>
        </span>
        <button type="button" className="icon-btn only-mobile" onClick={onClose} aria-label="Close menu">
          <Icon name="close" size={20} />
        </button>
      </div>

      <button type="button" className="btn btn-primary btn-block new-btn" onClick={onNew}>
        <Icon name="plus" size={18} /> New application
      </button>

      <section className="side-section" aria-labelledby="history-title">
        <div className="side-title-row">
          <h2 id="history-title">
            <Icon name="history" size={15} /> History
          </h2>
          {history.length > 0 && (
            <button type="button" className="btn-link tiny" onClick={onClearHistory}>
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="side-empty">Applications you file on this device appear here. Tap one to track it.</p>
        ) : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.applicationId}>
                <button type="button" onClick={() => onOpenHistory(h.applicationId)} title="Track this application">
                  <b>{h.applicationId}</b>
                  <span>
                    {formatRupees(h.loanRupees)} · {h.via === 'chat' ? 'via chat' : 'via form'}
                  </span>
                  <small>
                    {h.planName} · {formatDayMonth(h.at)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="side-foot">
        <div className={`status ${health.online ? 'online' : 'offline'}`} role="status">
          <span className="dot" aria-hidden="true" />
          {health.online ? 'Connected' : 'Offline – retrying'}
        </div>
        <small>{rate ? `Today's 24K gold rate: ${rate}/g` : 'Gold rate unavailable'}</small>
      </div>
    </aside>
  );
}
