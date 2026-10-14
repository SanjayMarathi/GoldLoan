import { useCallback, useEffect, useState } from 'react';
import { LEAD_STATUSES } from '@gold/shared/constants';
import { formatRupees } from '@gold/shared/format';
import type { LeadSummaryDto } from '@gold/shared/types';
import { api, isAbort } from '../api/client.ts';
import { STATUS_LABEL } from '../lib/status.ts';
import { LeadsTable } from './LeadsTable.tsx';

/** The admin panel: totals per status (each one filters the table), then every application. */
export function AdminPage({ version }: { version: number }) {
  const [summary, setSummary] = useState<LeadSummaryDto | null>(null);
  const [status, setStatus] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .summary(controller.signal)
      .then(setSummary)
      .catch((error: unknown) => {
        if (!isAbort(error)) setSummary(null);
      });
    return () => controller.abort();
  }, [version, tick]);

  const cards: Array<{ key: string; label: string; count: number; loan: number }> = [
    { key: '', label: 'All applications', count: summary?.total ?? 0, loan: summary?.totalLoanRupees ?? 0 },
    ...LEAD_STATUSES.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: summary?.byStatus[s].count ?? 0,
      loan: summary?.byStatus[s].loanRupees ?? 0,
    })),
  ];

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>Applications</h1>
        <p className="muted">Review applications, move them through the workflow and open any one in full. Demo admin view: no login, mobile numbers masked.</p>
      </header>

      <div className="kpis" role="group" aria-label="Filter applications by status">
        {cards.map((c) => (
          <button
            key={c.key || 'all'}
            type="button"
            className={`kpi${c.key ? ` kpi-${c.key}` : ''}${status === c.key ? ' on' : ''}`}
            aria-pressed={status === c.key}
            onClick={() => setStatus(status === c.key ? '' : c.key)}
          >
            <span className="kpi-label">{c.label}</span>
            <b className="kpi-count">{summary ? c.count : '–'}</b>
            <small>{summary ? `${formatRupees(c.loan)} in loans` : ' '}</small>
          </button>
        ))}
      </div>

      <LeadsTable version={version} status={status} onStatusChange={setStatus} onChanged={refresh} />
    </div>
  );
}
