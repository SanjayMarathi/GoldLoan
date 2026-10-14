import { useCallback, useEffect, useState } from 'react';
import { LEAD_STATUSES, STATUS_TRANSITIONS } from '@gold/shared/constants';
import type { LeadStatus } from '@gold/shared/constants';
import { formatDateTime, formatGramsFromMg, formatPaise, formatRupees } from '@gold/shared/format';
import type { LeadDto, LoanSchemeDto } from '@gold/shared/types';
import { ApiError, api, isAbort } from '../api/client.ts';
import { ACTION_LABEL, STATUS_LABEL } from '../lib/status.ts';
import { Icon } from './Icon.tsx';
import { LeadDrawer } from './LeadDrawer.tsx';

const PAGE_SIZE = 10;

type Load =
  | { status: 'loading'; rows?: LeadDto[] }
  | { status: 'ready'; rows: LeadDto[]; total: number }
  | { status: 'error'; message: string };

/**
 * Admin view: newest first, masked mobile (the server never sends the full number), filter by plan and status,
 * paging, quick status actions, and a details panel with everything about one application and its history.
 */
export function LeadsTable({ version }: { version: number }) {
  const [plans, setPlans] = useState<LoanSchemeDto[]>([]);
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerVersion, setDrawerVersion] = useState(0);

  useEffect(() => {
    api.schemes().then((r) => setPlans(r.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad((l) => ({ status: 'loading', ...(l.status === 'ready' ? { rows: l.rows } : {}) }));
    api
      .listLeads({ page, pageSize: PAGE_SIZE, ...(planId ? { planId } : {}), ...(status ? { status } : {}) }, controller.signal)
      .then((r) => setLoad({ status: 'ready', rows: r.data, total: r.total }))
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Could not load applications.' });
      });
    return () => controller.abort();
  }, [page, planId, status, version, reloadTick]);

  const total = load.status === 'ready' ? load.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = load.status === 'ready' ? load.rows : load.status === 'loading' ? (load.rows ?? []) : [];

  const replaceRow = useCallback((updated: LeadDto) => {
    setLoad((l) => (l.status === 'ready' ? { ...l, rows: l.rows.map((r) => (r.applicationId === updated.applicationId ? updated : r)) } : l));
  }, []);

  const move = useCallback(
    async (lead: LeadDto, to: LeadStatus) => {
      setBusyId(lead.applicationId);
      setRowError(null);
      try {
        replaceRow(await api.updateStatus(lead.applicationId, to));
        setDrawerVersion((v) => v + 1); // an open details panel reloads its status and history
      } catch (error) {
        setRowError(error instanceof ApiError ? error.message : 'Could not update the status.');
      } finally {
        setBusyId(null);
      }
    },
    [replaceRow],
  );

  const closeDrawer = useCallback(() => setOpenId(null), []);

  return (
    <section className="card wide">
      <header className="card-head row">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Applications</h1>
          <p className="muted">Newest first · mobile numbers are masked · demo admin view (no login)</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setReloadTick((n) => n + 1)} aria-label="Refresh applications">
          <Icon name="refresh" size={18} /> Refresh
        </button>
      </header>

      <div className="filters">
        <label>
          <span>Plan</span>
          <select
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <span className="count" aria-live="polite">
          {load.status === 'ready' ? `${total} application${total === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {rowError && (
        <div className="banner error" role="alert">
          <Icon name="alert" size={18} />
          <span>{rowError}</span>
        </div>
      )}

      {load.status === 'error' ? (
        <div className="empty-state">
          <p>{load.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => setReloadTick((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : load.status === 'ready' && rows.length === 0 ? (
        <div className="empty-state">
          <p>No applications {planId || status ? 'match these filters' : 'yet'}.</p>
        </div>
      ) : (
        <div className={`table-wrap${load.status === 'loading' ? ' loading' : ''}`} aria-busy={load.status === 'loading'}>
          <table className="leads">
            <thead>
              <tr>
                <th>Application</th>
                <th>Applicant</th>
                <th>Mobile</th>
                <th className="num">Net weight</th>
                <th>Plan</th>
                <th className="num">Loan</th>
                <th className="num">EMI / interest</th>
                <th>Status</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {load.status === 'loading' && rows.length === 0
                ? Array.from({ length: 4 }, (_, i) => (
                    <tr key={i} className="skeleton-row">
                      <td colSpan={9}>
                        <span className="skeleton-line" />
                      </td>
                    </tr>
                  ))
                : rows.map((lead) => (
                    <tr key={lead.applicationId}>
                      <td data-label="Application">
                        <b>{lead.applicationId}</b>
                        <small>{formatDateTime(lead.createdAt)}</small>
                      </td>
                      <td data-label="Applicant">{lead.name}</td>
                      <td data-label="Mobile" className="mono">
                        {lead.mobileNumber}
                      </td>
                      <td data-label="Net weight" className="num">
                        {formatGramsFromMg(Math.round(lead.netWeightGrams * 1000))} · {lead.karat}K
                      </td>
                      <td data-label="Plan">{lead.planName}</td>
                      <td data-label="Loan" className="num">
                        <b>{formatRupees(lead.eligibleLoanRupees)}</b>
                      </td>
                      <td data-label="EMI / interest" className="num">
                        <RepaymentCell lead={lead} />
                      </td>
                      <td data-label="Status">
                        <span className={`chip chip-${lead.status}`}>{STATUS_LABEL[lead.status]}</span>
                      </td>
                      <td className="actions-cell">
                        {STATUS_TRANSITIONS[lead.status].map((to) => (
                          <button
                            key={to}
                            type="button"
                            className={`btn btn-small ${to === 'REJECTED' ? 'btn-danger' : 'btn-ghost'}`}
                            disabled={busyId === lead.applicationId}
                            onClick={() => void move(lead, to)}
                          >
                            {ACTION_LABEL[to]}
                          </button>
                        ))}
                        <button type="button" className="btn btn-small btn-ghost details-btn" onClick={() => setOpenId(lead.applicationId)}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button type="button" className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </nav>
      )}

      {openId && <LeadDrawer applicationId={openId} version={drawerVersion} onClose={closeDrawer} onChanged={replaceRow} />}
    </section>
  );
}

function RepaymentCell({ lead }: { lead: LeadDto }) {
  const emi = lead.indicative.monthlyEmiPaise;
  return (
    <span className="repay-cell">
      {formatPaise(emi ?? lead.indicative.totalInterestPaise)}
      <small>
        {emi !== null ? '/month' : 'interest at maturity'} · {lead.annualInterestPercent}% · {lead.tenureMonths} mo
      </small>
    </span>
  );
}
