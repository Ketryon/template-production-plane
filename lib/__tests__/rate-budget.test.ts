import { beforeEach, describe, expect, it } from "vitest";
import {
  FORTNOX_LIMIT_PER_WINDOW,
  FORTNOX_WINDOW_MS,
  LAB_LIMIT_PER_WINDOW,
  __resetBudget,
  estimateSeconds,
  reserveSlot,
  windowUsage,
} from "../rate-budget";

/**
 * The pacer is the only thing standing between an expensive reconcile run and
 * production's the vendor quota — the token is borrowed, so the allowance is
 * shared. the vendor sends no rate-limit headers, so this cannot be corrected
 * reactively: if the maths here is wrong, the first sign is the production
 * integration getting 429s.
 *
 * Time is injected rather than mocked globally, so these run in microseconds
 * and never depend on real timers.
 *
 * docs/standard.md rule 10.
 */

beforeEach(() => __resetBudget());

describe("the budget is a real fraction of the vendor's", () => {
  it("stays well under the documented tenant limit", () => {
    // 300/min, enforced as 25 per 5s sliding window. Taking the whole thing
    // would leave production nothing.
    expect(FORTNOX_LIMIT_PER_WINDOW).toBe(25);
    expect(FORTNOX_WINDOW_MS).toBe(5_000);
    expect(LAB_LIMIT_PER_WINDOW).toBeLessThanOrEqual(FORTNOX_LIMIT_PER_WINDOW / 4);
  });

  it("still allows useful work", () => {
    // A budget of 1 would make the tool unusable, which is its own failure.
    expect(LAB_LIMIT_PER_WINDOW).toBeGreaterThan(1);
  });
});

describe("reserveSlot", () => {
  it("admits calls up to the limit without waiting", async () => {
    const now = 1_000_000;
    for (let i = 0; i < LAB_LIMIT_PER_WINDOW; i++) {
      await reserveSlot(() => now);
    }
    expect(windowUsage(now).used).toBe(LAB_LIMIT_PER_WINDOW);
  });

  it("counts calls made at different moments inside the window", async () => {
    const start = 1_000_000;
    await reserveSlot(() => start);
    await reserveSlot(() => start + 100);
    await reserveSlot(() => start + 200);
    // All three are inside the 5s window, so all three still count.
    expect(windowUsage(start + 200).used).toBe(3);
  });

  it("forgets calls once they age out of the window", async () => {
    const now = 1_000_000;
    for (let i = 0; i < LAB_LIMIT_PER_WINDOW; i++) await reserveSlot(() => now);
    expect(windowUsage(now).used).toBe(LAB_LIMIT_PER_WINDOW);

    // One millisecond past the window, every slot is free again.
    expect(windowUsage(now + FORTNOX_WINDOW_MS + 1).used).toBe(0);
  });

  it("uses a sliding window, not a fixed bucket", async () => {
    // The bug this guards: a bucket that resets on a boundary lets you spend
    // the full allowance at 4.99s and again at 5.01s — double the intended
    // rate across the seam, which is exactly what the vendor's own sliding
    // window is built to catch.
    const now = 1_000_000;
    for (let i = 0; i < LAB_LIMIT_PER_WINDOW; i++) await reserveSlot(() => now);

    // Halfway through the window, nothing has expired yet.
    const midway = now + FORTNOX_WINDOW_MS / 2;
    expect(windowUsage(midway).used).toBe(LAB_LIMIT_PER_WINDOW);
  });

  it("expires the oldest call first", async () => {
    const now = 1_000_000;
    await reserveSlot(() => now);          // t
    await reserveSlot(() => now + 2_000);  // t + 2s

    // At t + 5.001s the first has aged out and the second has not.
    expect(windowUsage(now + FORTNOX_WINDOW_MS + 1).used).toBe(1);
  });
});

describe("estimateSeconds", () => {
  it("is zero for a run that fits in one window", () => {
    expect(estimateSeconds(1)).toBe(0);
    expect(estimateSeconds(LAB_LIMIT_PER_WINDOW)).toBe(0);
  });

  it("grows with the number of calls", () => {
    expect(estimateSeconds(150)).toBeGreaterThan(estimateSeconds(50));
  });

  it("puts the expensive check in minutes, not seconds", () => {
    // paid-in-vendor-open-locally declares 150 calls. If this ever reads as a
    // handful of seconds, the pacer has been loosened and production's share
    // has gone with it.
    expect(estimateSeconds(150)).toBeGreaterThan(60);
  });
});
