// Time is injected so tests and seed data are deterministic.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that starts at `start` and advances `stepMs` on every read. */
export function steppingClock(start: string, stepMs = 60_000): Clock & { advance(ms: number): void } {
  let current = new Date(start).getTime();
  return {
    now() {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
