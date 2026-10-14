import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_TRANSITIONS } from '@gold/shared/constants';
import type { LeadStatus } from '@gold/shared/constants';
import type { LeadDetailDto, LeadDto } from '@gold/shared/types';
import { ApiError, api, isAbort } from '../api/client.ts';
import { ACTION_LABEL } from '../lib/status.ts';
import { ApplicationDetails } from './ApplicationDetails.tsx';
import { Icon } from './Icon.tsx';

type Load = { status: 'loading' } | { status: 'ready'; lead: LeadDetailDto } | { status: 'error'; message: string };

interface LeadDrawerProps {
  applicationId: string;
  /** bumps when the row was changed from the table, so the drawer reloads */
  version: number;
  onClose: () => void;
  onChanged: (lead: LeadDto) => void;
}

/** Admin side panel: one application in full, its status actions and its complete history (any status). */
export function LeadDrawer({ applicationId, version, onClose, onChanged }: LeadDrawerProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad((l) => (l.status === 'ready' && l.lead.applicationId === applicationId ? l : { status: 'loading' }));
    api
      .lead(applicationId, controller.signal)
      .then((lead) => setLoad({ status: 'ready', lead }))
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Could not load this application.' });
      });
    return () => controller.abort();
  }, [applicationId, version, tick]);

  // Dialog behaviour: focus the close button, Esc closes, focus returns to where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      previous?.focus?.();
    };
  }, [onClose]);

  const move = useCallback(
    async (to: LeadStatus) => {
      setBusy(true);
      setActionError(null);
      try {
        const updated = await api.updateStatus(applicationId, to);
        onChanged(updated);
        setTick((n) => n + 1); // reload: new status AND the new history line
      } catch (error) {
        setActionError(error instanceof ApiError ? error.message : 'Could not update the status.');
      } finally {
        setBusy(false);
      }
    },
    [applicationId, onChanged],
  );

  const next = load.status === 'ready' ? STATUS_TRANSITIONS[load.lead.status] : [];

  // Rendered at the page level: inside the animated card, `position: fixed` would be trapped in the card.
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div>
            <span className="eyebrow">Application</span>
            <h2 id="drawer-title">{applicationId}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="drawer-body">
          {load.status === 'ready' && (
            <div className="drawer-actions">
              {next.length > 0 ? (
                next.map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={`btn btn-small ${to === 'REJECTED' ? 'btn-danger' : to === 'APPROVED' ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={busy}
                    onClick={() => void move(to)}
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))
              ) : (
                <span className="muted">Final status – no further actions.</span>
              )}
            </div>
          )}
          {actionError && (
            <div className="banner error" role="alert">
              <Icon name="alert" size={18} />
              <span>{actionError}</span>
            </div>
          )}

          {load.status === 'loading' && (
            <div className="drawer-loading" aria-busy="true">
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
            </div>
          )}
          {load.status === 'error' && (
            <div className="empty-state">
              <p>{load.message}</p>
              <button type="button" className="btn btn-primary" onClick={() => setTick((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {load.status === 'ready' && <ApplicationDetails lead={load.lead} audience="admin" />}
        </div>
      </aside>
    </>,
    document.body,
  );
}
