/**
 * Per-org limits (BACKEND.md §3.1): 60 calls/minute and 5 concurrent calls.
 * In-process only; when refresh moves to Inngest, the job's concurrency key replaces the semaphore.
 */
type Bucket = { tokens: number; updated: number; active: number; waiters: (() => void)[] };

export class OrgLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private perMinute = 60,
    private concurrent = 5,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.perMinute, updated: this.now(), active: 0, waiters: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  private refill(b: Bucket) {
    const t = this.now();
    const add = ((t - b.updated) / 60_000) * this.perMinute;
    b.tokens = Math.min(this.perMinute, b.tokens + add);
    b.updated = t;
  }

  /** Remaining-minute header from Xero overrides our estimate when it is lower. */
  observeMinuteRemaining(key: string, remaining: number) {
    const b = this.bucket(key);
    this.refill(b);
    b.tokens = Math.min(b.tokens, remaining);
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const b = this.bucket(key);
    while (b.active >= this.concurrent) await new Promise<void>((r) => b.waiters.push(r));
    b.active++;
    try {
      for (;;) {
        this.refill(b);
        if (b.tokens >= 1) {
          b.tokens -= 1;
          break;
        }
        await this.sleep(Math.ceil(((1 - b.tokens) / this.perMinute) * 60_000));
      }
      return await fn();
    } finally {
      b.active--;
      b.waiters.shift()?.();
    }
  }

  stats(key: string) {
    const b = this.bucket(key);
    this.refill(b);
    return { tokens: b.tokens, active: b.active };
  }
}

export const limiter = new OrgLimiter();
