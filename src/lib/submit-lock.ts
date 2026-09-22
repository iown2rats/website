/**
 * "One click, one request" as a plain object, so the rule can be tested rather than trusted.
 *
 * A form that guards itself with React state does not actually guard itself: `busy` is set asynchronously, so two
 * submit events dispatched in the same tick both read the stale `false` and both fire. The lock below is taken and
 * released synchronously, which is the only way the second one loses.
 *
 * It also owns the cooldown after a refusal that carried one (an HTTP 429 or our own rate limiter). While the
 * cooldown runs, `run` refuses without calling the work at all: a rate-limited form that keeps trying is how a
 * rate limit becomes a permanent one. Nothing in here retries anything — releasing the lock is as far as it goes.
 */

export type SubmitAttempt<T> = { ran: true; value: T } | { ran: false; reason: "in-flight" | "cooling-down" };

export interface SubmitLock {
  /** True while a request is in flight or a cooldown is running. Drives the disabled state, never the guard. */
  isLocked(now?: number): boolean;
  /** Whole seconds left on the cooldown, or 0. */
  remaining(now?: number): number;
  /** Runs `work` at most once at a time, and never while cooling down. */
  run<T>(work: () => Promise<T>, now?: number): Promise<SubmitAttempt<T>>;
  /** Starts (or extends) a cooldown. Only ever extends, so a later, longer window is not shortened by an earlier. */
  cool(seconds: number, now?: number): void;
}

export function createSubmitLock(): SubmitLock {
  let running = false;
  let blockedUntil = 0;

  const remaining = (now = Date.now()): number => Math.max(0, Math.ceil((blockedUntil - now) / 1000));

  return {
    remaining,
    isLocked: (now = Date.now()) => running || blockedUntil > now,
    cool(seconds, now = Date.now()) {
      if (seconds <= 0) return;
      blockedUntil = Math.max(blockedUntil, now + seconds * 1000);
    },
    async run<T>(work: () => Promise<T>, now = Date.now()): Promise<SubmitAttempt<T>> {
      if (running) return { ran: false, reason: "in-flight" };
      if (blockedUntil > now) return { ran: false, reason: "cooling-down" };
      running = true;
      try {
        return { ran: true, value: await work() };
      } finally {
        // Released even when the work throws, so one failure never wedges the form shut.
        running = false;
      }
    },
  };
}
