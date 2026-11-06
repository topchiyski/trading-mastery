/** Sliding-window rate limiter over several windows (e.g. 50/hour and 1,000/day). */
export interface RateWindow {
  max: number;
  windowMs: number;
  label?: string;
}

export class RateLimiter {
  private readonly stamps: number[][];

  constructor(
    private readonly windows: RateWindow[],
    private readonly now: () => number = Date.now,
  ) {
    this.stamps = windows.map(() => []);
  }

  private prune(): void {
    const t = this.now();
    this.windows.forEach((w, i) => {
      const s = this.stamps[i] ?? [];
      while (s.length > 0 && t - (s[0] ?? 0) >= w.windowMs) s.shift();
    });
  }

  /** Milliseconds until a request is allowed (0 = now). */
  waitMs(): number {
    this.prune();
    const t = this.now();
    return Math.max(
      0,
      ...this.windows.map((w, i) => {
        const s = this.stamps[i] ?? [];
        return s.length < w.max ? 0 : (s[0] ?? t) + w.windowMs - t;
      }),
    );
  }

  /** Take a slot if one is free. */
  tryAcquire(): boolean {
    if (this.waitMs() > 0) return false;
    const t = this.now();
    for (const s of this.stamps) s.push(t);
    return true;
  }

  usage(): { label: string; used: number; max: number }[] {
    this.prune();
    return this.windows.map((w, i) => ({
      label: w.label ?? `${w.windowMs}ms`,
      used: this.stamps[i]?.length ?? 0,
      max: w.max,
    }));
  }
}

/** Tiingo free (Starter) plan: 50 requests/hour, 1,000/day. */
export const tiingoFreeLimits = (): RateWindow[] => [
  { max: 50, windowMs: 3_600_000, label: 'hour' },
  { max: 1_000, windowMs: 86_400_000, label: 'day' },
];
