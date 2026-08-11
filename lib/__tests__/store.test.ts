import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, clipBody } from "../store";

/**
 * The store holds production personal data — `response_body` is whatever
 * the vendor returned, which for a customer or invoice read is names, addresses
 * and organisation numbers. docs/standard.md rule 8 is what these cover: the
 * retention window is a stated number rather than an assumption, and the cap on
 * a stored body actually caps.
 *
 * Only the pure parts are tested here. The sweep itself needs a database, and
 * its plan was checked against the real one when the index was applied
 * (Index Scan using idx_call_log_created_at, not a Seq Scan).
 */

describe("RETENTION_DAYS", () => {
  it("is 30 days", () => {
    // Pinned deliberately. This number is the difference between "bounded" and
    // "indefinitely accumulating a copy of production personal data", so
    // changing it should be a decision someone makes on purpose, in a diff,
    // rather than a constant someone nudges.
    expect(RETENTION_DAYS).toBe(30);
  });

  it("is a whole number of days, since make_interval takes days", () => {
    expect(Number.isInteger(RETENTION_DAYS)).toBe(true);
    expect(RETENTION_DAYS).toBeGreaterThan(0);
  });
});

describe("clipBody", () => {
  it("passes null through", () => {
    expect(clipBody(null)).toBeNull();
  });

  it("leaves a body under the cap untouched", () => {
    // The measured median is ~3 000 chars, so the overwhelming majority of real
    // bodies take this path and must come back byte-identical — the History
    // page parses them as JSON.
    const body = JSON.stringify({ Invoice: { DocumentNumber: 74832 } });
    expect(clipBody(body)).toBe(body);
  });

  it("leaves a body exactly at the cap untouched", () => {
    const body = "x".repeat(20_000);
    expect(clipBody(body)).toBe(body);
  });

  it("truncates a body over the cap and says by how much", () => {
    const clipped = clipBody("x".repeat(20_050));
    expect(clipped).toContain("[truncated 50 chars]");
    // The marker must survive: a silently shortened body reads as a complete
    // response that happens to be malformed.
    expect(clipped!.startsWith("x".repeat(20_000))).toBe(true);
  });

  it("never returns more than the cap plus its own marker", () => {
    const huge = clipBody("x".repeat(5_000_000))!;
    expect(huge.length).toBeLessThan(20_100);
  });

  it("handles a body of exactly one char over", () => {
    expect(clipBody("x".repeat(20_001))).toContain("[truncated 1 chars]");
  });
});
