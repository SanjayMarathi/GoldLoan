/** Time is injected so the 7-day duplicate window and caches are testable without sleeping. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test / eval clock that only moves when told to. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date | string = '2026-10-01T09:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceMs(ms: number): void {
    this.current += ms;
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 24 * 60 * 60 * 1000);
  }
}
