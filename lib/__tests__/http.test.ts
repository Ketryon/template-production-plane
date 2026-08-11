import { describe, expect, it } from "vitest";
import {
  BASE_URL,
  SIDE_EFFECTING_SEGMENTS,
  isSideEffecting,
  normalisePath,
  toCurl,
} from "../http";

/**
 * `isSideEffecting` is the one function in this repo whose failure is
 * irreversible: it is what stops `GET /3/invoices/{n}/email` mailing a live
 * invoice to a real customer using the observed system's production credentials. Every
 * other guard here can be re-run; a sent invoice cannot be unsent.
 *
 * So these tests are written to fail on the two changes that would actually hurt:
 * silently dropping a segment from the guard, and silently widening what counts
 * as a read. Both are one-character edits in a regex, which is why the list is
 * exported and asserted literally rather than inspected through the regex.
 *
 * docs/standard.md rule 6.
 */

describe("SIDE_EFFECTING_SEGMENTS", () => {
  // The tripwire. Deleting a segment from lib/http.ts fails HERE, loudly, with
  // the name of the thing that is no longer guarded — rather than silently
  // passing every other test in this file because they iterate the same list.
  // ── FILL THIS IN, TOGETHER WITH lib/http.ts ──────────────────────────────
  //
  // This list must be edited in lockstep with SIDE_EFFECTING_SEGMENTS, and that
  // is the entire point: it is the tripwire. Deleting a segment from the guard
  // fails HERE, loudly, naming the thing that is no longer guarded — rather than
  // passing silently because every other test derives from the same list.
  //
  // It is meant to be mildly annoying. The alternative is a guard that can be
  // quietly loosened by one character.
  const EXPECTED_UNSAFE = [
    "email",
    "einvoice",
    "eprint",
    "externalprint",
    "print",
    "bookkeep",
    "credit",
    "cancel",
    "warehouseready",
  ];

  it("contains exactly the segments we have decided are unsafe", () => {
    expect([...SIDE_EFFECTING_SEGMENTS]).toEqual(EXPECTED_UNSAFE);
  });

  it("has no duplicates", () => {
    expect(new Set(SIDE_EFFECTING_SEGMENTS).size).toBe(
      SIDE_EFFECTING_SEGMENTS.length,
    );
  });
});

describe("isSideEffecting — refuses dispatching GETs", () => {
  // Derived from the guard's own list rather than hand-written alongside it.
  // An earlier version kept a parallel table of [segment, example path] pairs,
  // which meant filling in the guard for a new vendor — step 2 of the README —
  // broke sixteen tests. A template whose tests fail when you follow its own
  // setup instructions is worse than one with no tests.
  const dispatching = SIDE_EFFECTING_SEGMENTS.map(
    (segment) => [segment, `/v1/records/12345/${segment}`] as const,
  );

  it.each(dispatching)("refuses GET on /%s", (_segment, path) => {
    expect(isSideEffecting("GET", path)).toBe(true);
  });

  it("refuses regardless of the parent resource", () => {
    for (const parent of ["records", "orders", "documents", "batches"]) {
      expect(isSideEffecting("GET", `/v1/${parent}/1/${SIDE_EFFECTING_SEGMENTS[0]}`)).toBe(true);
    }
  });

  it("ignores the query string", () => {
    // A dispatch is a dispatch whatever is appended to it. This is the check
    // that stops `?` being used to walk straight past the guard.
    expect(isSideEffecting("GET", `/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}?foo=1`)).toBe(true);
    expect(isSideEffecting("GET", `/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}?x=y&z=1`)).toBe(true);
  });

  const ic = (p: string) => p.toUpperCase();

  it("is case-insensitive", () => {
    expect(isSideEffecting("GET", ic(`/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}`))).toBe(true);
    expect(isSideEffecting("GET", ic(`/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}`))).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(isSideEffecting("GET", `/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}/`)).toBe(true);
  });
});

describe("isSideEffecting — write methods", () => {
  it.each(["POST", "PUT", "DELETE"] as const)(
    "refuses %s even on a plainly readable path",
    (method) => {
      expect(isSideEffecting(method, "/v1/customers")).toBe(true);
    },
  );

  it("refuses a write method on an empty path", () => {
    expect(isSideEffecting("POST", "")).toBe(true);
  });
});

describe("isSideEffecting — deliberate exclusions", () => {
  /**
   * These MUST stay allowed. An untested exclusion is indistinguishable from an
   * oversight: without these cases, someone tightening the regex would break the
   * catalog and no test would say so.
   *
   * /preview is the one that matters — it is how catalog.ts's "delivery-preview"
   * operation fetches an invoice PDF, and it is the reason refusing /print is
   * free.
   */
  const reads = [
    "/v1/records/12345/preview",
    "/v1/records/12345",
    "/v1/records",
    "/v1/records?filter=open&limit=10",
    "/v1/customers?number=12345",
    "/v1/payments?record=1",
    "/v1/accounts",
    "/v1/payment-modes",
    "/v1/settings",
    "/v1/related/12345",
    "/v1/attachments?entityId=1",
  ];

  it.each(reads)("allows GET %s", (path) => {
    expect(isSideEffecting("GET", path)).toBe(false);
  });

  it("only matches a whole trailing segment, not a substring", () => {
    // `/3/emailsenders` is a read. If the guard ever stops anchoring on the
    // segment boundary it would start refusing legitimate endpoints, and the
    // failure mode of an over-tight guard is a lab nobody can use.
    expect(isSideEffecting("GET", "/v1/emailsenders")).toBe(false);
    expect(isSideEffecting("GET", "/v1/records/1/emails")).toBe(false);
    expect(isSideEffecting("GET", "/v1/printtemplates")).toBe(false);
    expect(isSideEffecting("GET", "/v1/creditors")).toBe(false);
  });
});

describe("normalisePath", () => {
  it("passes a bare path through", () => {
    expect(normalisePath("/v1/customers")).toBe("/v1/customers");
  });

  it("adds a leading slash", () => {
    expect(normalisePath("v1/customers")).toBe("/v1/customers");
  });

  it("strips an absolute the vendor URL pasted from the docs", () => {
    expect(normalisePath(`${BASE_URL}/v1/customers`)).toBe("/v1/customers");
  });

  it("trims surrounding whitespace", () => {
    expect(normalisePath("  /v1/customers  ")).toBe("/v1/customers");
  });

  it("throws on an empty path", () => {
    expect(() => normalisePath("")).toThrow(/Path is required/);
    expect(() => normalisePath("   ")).toThrow(/Path is required/);
  });

  it("normalises a dispatching absolute URL into something the guard catches", () => {
    // The two functions are used together in proxy.ts (normalise, then guard).
    // Pasting the absolute form must not be a way around the check.
    const path = normalisePath(`${BASE_URL}/v1/records/1/${SIDE_EFFECTING_SEGMENTS[0]}`);
    expect(isSideEffecting("GET", path)).toBe(true);
  });
});

describe("toCurl", () => {
  it("never interpolates a real token", () => {
    const curl = toCurl("GET", "/v1/customers");
    expect(curl).toContain("$VENDOR_TOKEN");
    expect(curl).toContain(`'${BASE_URL}/v1/customers'`);
  });

  it("cannot emit a request body", () => {
    // Not a style point. A curl builder for a read-only lab that can still
    // assemble a `-d` payload is a write path someone can copy out of the UI
    // and run. The signature is the guard: there is nowhere to put one.
    expect(toCurl("GET", "/v1/customers")).not.toContain("-d ");
    expect(toCurl("GET", "/v1/customers")).not.toContain("Content-Type");
  });
});
