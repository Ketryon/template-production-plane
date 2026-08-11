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
  it("contains exactly the segments we have decided are unsafe", () => {
    expect([...SIDE_EFFECTING_SEGMENTS]).toEqual([
      "email",
      "einvoice",
      "eprint",
      "externalprint",
      "print",
      "bookkeep",
      "credit",
      "cancel",
      "warehouseready",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(SIDE_EFFECTING_SEGMENTS).size).toBe(
      SIDE_EFFECTING_SEGMENTS.length,
    );
  });
});

describe("isSideEffecting — refuses dispatching GETs", () => {
  // One realistic path per segment. the vendor hangs these suffixes off several
  // resources, so the cases below deliberately vary the parent.
  const dispatching: Array<[string, string]> = [
    ["email", "/3/invoices/12345/email"],
    ["einvoice", "/3/invoices/12345/einvoice"],
    ["eprint", "/3/invoices/12345/eprint"],
    ["externalprint", "/3/invoices/12345/externalprint"],
    ["print", "/3/invoices/12345/print"],
    ["bookkeep", "/3/invoices/12345/bookkeep"],
    ["credit", "/3/invoices/12345/credit"],
    ["cancel", "/3/orders/987/cancel"],
    ["warehouseready", "/3/orders/987/warehouseready"],
  ];

  it.each(dispatching)("refuses GET on /%s", (_segment, path) => {
    expect(isSideEffecting("GET", path)).toBe(true);
  });

  it("covers every segment in the exported list", () => {
    // Guards against someone adding a segment to lib/http.ts and to the literal
    // assertion above, but forgetting to give it a case here.
    expect(dispatching.map(([segment]) => segment)).toEqual([
      ...SIDE_EFFECTING_SEGMENTS,
    ]);
  });

  it("refuses regardless of the parent resource", () => {
    for (const parent of ["invoices", "orders", "offers", "supplierinvoices"]) {
      expect(isSideEffecting("GET", `/3/${parent}/1/email`)).toBe(true);
    }
  });

  it("ignores the query string", () => {
    // A dispatch is a dispatch whatever is appended to it. This is the check
    // that stops `?` being used to walk straight past the guard.
    expect(isSideEffecting("GET", "/3/invoices/1/email?foo=1")).toBe(true);
    expect(isSideEffecting("GET", "/3/invoices/1/bookkeep?x=y&z=1")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSideEffecting("GET", "/3/invoices/1/EMAIL")).toBe(true);
    expect(isSideEffecting("GET", "/3/invoices/1/BookKeep")).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(isSideEffecting("GET", "/3/invoices/1/email/")).toBe(true);
  });
});

describe("isSideEffecting — write methods", () => {
  it.each(["POST", "PUT", "DELETE"] as const)(
    "refuses %s even on a plainly readable path",
    (method) => {
      expect(isSideEffecting(method, "/3/customers")).toBe(true);
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
    "/3/invoices/12345/preview",
    "/3/invoices/12345",
    "/3/invoices",
    "/3/invoices?filter=unbooked&limit=10",
    "/3/customers?organisationnumber=5593783367",
    "/3/invoicepayments?invoicenumber=1",
    "/3/predefinedaccounts",
    "/3/modesofpayments",
    "/3/settings/company",
    "/3/noxfinansinvoices/12345",
    "/api/fileattachments/attachments-v1?entityType=F&entityId=1",
  ];

  it.each(reads)("allows GET %s", (path) => {
    expect(isSideEffecting("GET", path)).toBe(false);
  });

  it("only matches a whole trailing segment, not a substring", () => {
    // `/3/emailsenders` is a read. If the guard ever stops anchoring on the
    // segment boundary it would start refusing legitimate endpoints, and the
    // failure mode of an over-tight guard is a lab nobody can use.
    expect(isSideEffecting("GET", "/3/emailsenders")).toBe(false);
    expect(isSideEffecting("GET", "/3/invoices/1/emails")).toBe(false);
    expect(isSideEffecting("GET", "/3/printtemplates")).toBe(false);
    expect(isSideEffecting("GET", "/3/creditors")).toBe(false);
  });
});

describe("normalisePath", () => {
  it("passes a bare path through", () => {
    expect(normalisePath("/3/customers")).toBe("/3/customers");
  });

  it("adds a leading slash", () => {
    expect(normalisePath("3/customers")).toBe("/3/customers");
  });

  it("strips an absolute the vendor URL pasted from the docs", () => {
    expect(normalisePath(`${BASE_URL}/3/customers`)).toBe("/3/customers");
  });

  it("trims surrounding whitespace", () => {
    expect(normalisePath("  /3/customers  ")).toBe("/3/customers");
  });

  it("throws on an empty path", () => {
    expect(() => normalisePath("")).toThrow(/Path is required/);
    expect(() => normalisePath("   ")).toThrow(/Path is required/);
  });

  it("normalises a dispatching absolute URL into something the guard catches", () => {
    // The two functions are used together in proxy.ts (normalise, then guard).
    // Pasting the absolute form must not be a way around the check.
    const path = normalisePath(`${BASE_URL}/3/invoices/1/email`);
    expect(isSideEffecting("GET", path)).toBe(true);
  });
});

describe("toCurl", () => {
  it("never interpolates a real token", () => {
    const curl = toCurl("GET", "/3/customers");
    expect(curl).toContain("$FORTNOX_TOKEN");
    expect(curl).toContain(`'${BASE_URL}/3/customers'`);
  });

  it("cannot emit a request body", () => {
    // Not a style point. A curl builder for a read-only lab that can still
    // assemble a `-d` payload is a write path someone can copy out of the UI
    // and run. The signature is the guard: there is nowhere to put one.
    expect(toCurl("GET", "/3/customers")).not.toContain("-d ");
    expect(toCurl("GET", "/3/customers")).not.toContain("Content-Type");
  });
});
