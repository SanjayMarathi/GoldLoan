import { useCallback, useState } from 'react';
import { readJson, writeJson } from '../lib/storage.ts';

export interface HistoryEntry {
  applicationId: string;
  loanRupees: number;
  planName: string;
  at: string;
  via: 'form' | 'chat';
}

const KEY = 'gl-history-v1';
const MAX = 12;

/** The applications filed from THIS browser (the sidebar "History"). The server remains the source of truth. */
export function useHistory(): { entries: HistoryEntry[]; add: (entry: HistoryEntry) => void; clear: () => void } {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => readJson<HistoryEntry[]>(KEY, []));

  const add = useCallback((entry: HistoryEntry) => {
    setEntries((current) => {
      const next = [entry, ...current.filter((e) => e.applicationId !== entry.applicationId)].slice(0, MAX);
      writeJson(KEY, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    writeJson(KEY, []);
  }, []);

  return { entries, add, clear };
}
