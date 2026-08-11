/**
 * The lab's self-imposed share of the vendor's rate limit.
 *
 * This exists because borrowing production's access token means borrowing
 * production's quota. the example vendor limits **300 requests per minute per client-id and
 * tenant**, enforced as a sliding window of **25 requests per 5 seconds**. That
 * budget is not per-application — the integration and this lab draw down the
 * same allowance, so an expensive reconcile run competes directly with the
 * payment sync it exists to diagnose.
 *
 * Nothing in the response tells us how much is left. This vendor returned no
 * rate-limit headers at all (verified against the live API on 2026-08-11: no
 * `X-RateLimit-*`, no `RateLimit-*`, nothing). So this cannot be reactive — the
 * only option is to pace ourselves below the limit and never find out how close
 * we got.
 *
 * The share is deliberately small. A diagnostic tool that degrades production is
 * worse than no diagnostic tool, and the lab is used by one admin occasionally
 * while the integration runs unattended on a schedule.
 */

/** the vendor's actual limit, for reference in errors and the UI. */
export const VENDOR_WINDOW_MS = 5_000;
export const VENDOR_LIMIT_PER_WINDOW = 25;

/**
 * What the lab allows itself: 5 of the vendor's 25 per 5 seconds — 20%, leaving
 * production the rest. At this rate the most expensive check (150 sequential
 * invoice reads) takes about two and a half minutes instead of arriving as a
 * burst, which is the trade this whole module is making: slower here, so that
 * nothing gets slower there.
 */
export const PLANE_LIMIT_PER_WINDOW = 5;

/**
 * Timestamps of recent calls, oldest first. A sliding window rather than a
 * fixed-bucket counter, because a bucket lets you fire the full allowance at
 * 4.99s and again at 5.01s — double the intended rate across the boundary,
 * which is exactly the burst the vendor's own sliding window is designed to catch.
 */
let recent: number[] = [];

/** Serialises waiters so N concurrent callers queue rather than all racing. */
let tail: Promise<void> = Promise.resolve();

function prune(now: number): void {
  const cutoff = now - VENDOR_WINDOW_MS;
  // Oldest-first, so dropping from the front is enough.
  let i = 0;
  while (i < recent.length && recent[i] <= cutoff) i++;
  if (i > 0) recent = recent.slice(i);
}

/** Milliseconds until a slot frees up, or 0 if one is free now. */
function waitFor(now: number): number {
  prune(now);
  if (recent.length < PLANE_LIMIT_PER_WINDOW) return 0;
  // The oldest call in the window is the one whose expiry frees a slot.
  return recent[0] + VENDOR_WINDOW_MS - now + 1;
}

/**
 * Block until this call fits inside the lab's share, then record it.
 *
 * Chained through `tail` so concurrent callers are admitted one at a time and
 * each sees the reservations the others already made. Without that, ten
 * simultaneous calls would all read an empty window and all proceed.
 */
export async function reserveSlot(now: () => number = Date.now): Promise<void> {
  const mine = tail.then(async () => {
    for (;;) {
      const wait = waitFor(now());
      if (wait <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    recent.push(now());
  });
  // Swallow on the shared chain so one failure does not poison every later
  // waiter; the caller still sees its own rejection through `mine`.
  tail = mine.catch(() => {});
  return mine;
}

/** How many calls the lab has made in the current window. Used by the UI. */
export function windowUsage(now: number = Date.now()): {
  used: number;
  limit: number;
} {
  prune(now);
  return { used: recent.length, limit: PLANE_LIMIT_PER_WINDOW };
}

/**
 * Roughly how long `calls` sequential reads will take under this budget.
 * Surfaced before an expensive run so the operator can decline rather than
 * discover it.
 */
export function estimateSeconds(calls: number): number {
  if (calls <= PLANE_LIMIT_PER_WINDOW) return 0;
  return Math.round(
    ((calls - PLANE_LIMIT_PER_WINDOW) / PLANE_LIMIT_PER_WINDOW) *
      (VENDOR_WINDOW_MS / 1000),
  );
}

/** Test seam — resets the window between cases. */
export function __resetBudget(): void {
  recent = [];
  tail = Promise.resolve();
}
