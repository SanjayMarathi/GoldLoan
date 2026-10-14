import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { HealthDto } from '../api/client.ts';

export type Health = { online: boolean; info: HealthDto | null };

/** Polls /health so the sidebar can honestly show "Connected" or "Offline". */
export function useHealth(intervalMs = 30_000): Health {
  const [health, setHealth] = useState<Health>({ online: false, info: null });

  useEffect(() => {
    let alive = true;
    let controller = new AbortController();

    const check = async (): Promise<void> => {
      controller.abort();
      controller = new AbortController();
      try {
        const info = await api.health(controller.signal);
        if (alive) setHealth({ online: info.status === 'ok', info });
      } catch {
        if (alive && !controller.signal.aborted) setHealth({ online: false, info: null });
      }
    };

    void check();
    const timer = window.setInterval(check, intervalMs);
    const onOnline = (): void => void check();
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [intervalMs]);

  return health;
}
