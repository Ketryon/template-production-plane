/**
 * Every read this plane can perform, as data.
 *
 * This file is the point of the whole shape, and it is easy to skip. A plane
 * that only has a free-form console is a `curl` wrapper with a login. A plane
 * with a catalog accumulates something no API client gives you: **a record of
 * what the vendor really does, as opposed to what its documentation says.**
 *
 * READS ONLY. This observes production using production's own credentials, so
 * nothing here may create, send, book or cancel. The guard is in lib/http.ts and
 * is absolute — an entry that resolved to a dispatching path would be refused,
 * not merely discouraged.
 *
 * `note` is mandatory on purpose. It is for what the docs do not tell you and
 * you only learn by having something go wrong at 2am. Those notes are the actual
 * output of a tool like this; the buttons are just how you get at them. Real
 * examples from the plane this was extracted from:
 *
 *   - the `Sent` flag only tracks the vendor's OWN dispatch. An invoice
 *     delivered by their factoring arm leaves it false forever, so "never sent"
 *     in your reporting is wrong for every factored invoice.
 *   - a booked payment is not proof of cash. One payment mode is a rounding
 *     entry, and treating it as money makes every balance drift by öre.
 *   - the payment LIST omits the one field you need to classify a payment, so
 *     the sync needs a second call per payment — and no amount of reading the
 *     list endpoint's docs tells you that.
 *
 * None of those are in any changelog. They cost an incident each.
 */

export type Values = Record<string, string>;

export type ParamKind = "text" | "number" | "select";

export interface OpParam {
  name: string;
  label: string;
  kind?: ParamKind;
  required?: boolean;
  placeholder?: string;
  initial?: string;
  options?: string[];
  help?: string;
}

export interface Operation {
  id: string;
  group: string;
  label: string;
  /** One line: what you learn by running it. */
  blurb: string;
  /**
   * Build the path from the form values. Must resolve to a READ — anything
   * matching SIDE_EFFECTING_SEGMENTS is refused by lib/proxy.ts.
   */
  buildPath: (v: Values) => string;
  params?: OpParam[];
  /**
   * Hard-won behaviour that is not in the official docs. REQUIRED.
   *
   * Typed as a plain string rather than an optional one so that leaving it out
   * is a compile error. An optional field here would be empty on most entries
   * within a month, and the notes are the reason this file exists.
   */
  note: string;
}

/** Small helper for query strings that skips empty values. */
export function qs(base: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const q = search.toString();
  return q ? `${base}?${q}` : base;
}

/**
 * REPLACE THESE. Two examples showing the shape, not a starting set — the whole
 * value is in entries specific to your vendor.
 */
export const CATALOG: Operation[] = [
  {
    id: "example-list",
    group: "examples",
    label: "List recent records",
    blurb: "What the vendor has touched lately, newest first.",
    params: [{ name: "limit", label: "Limit", kind: "number", initial: "10" }],
    buildPath: (v) => qs("/records", { limit: v.limit }),
    note:
      "Replace this. If you cannot think of anything the docs failed to tell you about an endpoint, you have probably not used it in anger yet — which is fine, but say so here rather than leaving the field to fill itself in later.",
  },
  {
    id: "example-single",
    group: "examples",
    label: "One record by id",
    blurb: "The full shape of a single record, including the fields the list omits.",
    params: [{ name: "id", label: "Id", required: true }],
    buildPath: (v) => `/records/${encodeURIComponent(v.id ?? "")}`,
    note:
      "Worth checking early whether the list and the detail endpoints agree. Where they do not — a field present on one and absent on the other — that difference usually explains an extra call somewhere in your production sync, and is exactly the sort of thing to record here.",
  },
];

export function getOperation(id: string): Operation | undefined {
  return CATALOG.find((op) => op.id === id);
}
