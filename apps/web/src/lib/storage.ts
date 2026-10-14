/** localStorage / sessionStorage can throw (private windows, blocked cookies) – every access is guarded. */
type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T, kind: Area = 'local'): T {
  try {
    const raw = area(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, kind: Area = 'local'): void {
  try {
    area(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable – the app keeps working, it just will not remember */
  }
}

export function readString(key: string, kind: Area = 'local'): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string, kind: Area = 'local'): void {
  try {
    area(kind)?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function removeKey(key: string, kind: Area = 'local'): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
