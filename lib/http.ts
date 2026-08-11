/**
 * Pure request helpers, shared by the server proxy and the client UI.
 *
 * COPY THIS FILE VERBATIM. The only thing to change is the contents of
 * SIDE_EFFECTING_SEGMENTS, and changing that is the most consequential edit in
 * the whole template — see below.
 *
 * It exists as its own module to stay importable from a "use client" component:
 * its sibling lib/proxy.ts imports the store, which opens a Postgres connection,
 * so importing anything from there into the browser bundle would drag a
 * server-only dependency with it. Everything here is plain functions with no
 * runtime deps, which is also what makes it the one module worth testing hard.
 */

/**
 * The vendor API this plane reads. One place, so nothing constructs a URL by
 * hand and quietly points at the wrong host.
 */
export const BASE_URL = process.env.VENDOR_API_BASE_URL ?? "https://api.example.com";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export const WRITE_METHODS: HttpMethod[] = ["POST", "PUT", "DELETE"];

/**
 * Vendor endpoints that are GET but are NOT reads. ← FILL THIS IN PER VENDOR.
 *
 * The segments below are examples drawn from a real accounting API, where
 * `GET /invoices/{n}/email` mails the invoice to the customer, and /einvoice,
 * /eprint and /externalprint dispatch too. Yours will differ. Deriving this list
 * for your vendor is the single most important hour of setting up a new plane —
 * everything else here can be re-run; a sent invoice cannot be unsent.
 *
 * Work through the vendor's action endpoints and ask of each: does calling this
 * cause something to leave the building, or change state a human would notice?
 * When the documentation will not say, REFUSE IT. If a documented read-only
 * alternative exists (a /preview to a /print), refusing costs nothing and the
 * bet is asymmetric.
 *
 * RFC 9110 §9.2.1 puts the responsibility for a method being *safe* on the
 * origin server, not the client — so a client cannot infer safety from the verb,
 * and a guard keyed on HTTP method alone has a hole big enough to mail a live
 * customer through. This list, not the method, is the guard.
 *
 * `print` is in the example list on precautionary grounds rather than confirmed
 * behaviour — an illustration of the rule above. Remove an entry only against
 * documentation, never against a guess, and never by testing it in production:
 * the safe test targets are the ones where nothing observable changes, and the
 * conclusive ones are exactly where a dispatch reaches a real customer.
 *
 * Exported so the test drives off the same list the guard does. A regex literal
 * is easy to edit without noticing what it protects; an exported array with a
 * test asserting its exact contents is not.
 */
export const SIDE_EFFECTING_SEGMENTS = [
  "email",
  "einvoice",
  "eprint",
  "externalprint",
  "print",
  "bookkeep",
  "credit",
  "cancel",
  "warehouseready",
] as const;

const SIDE_EFFECTING_PATH = new RegExp(
  `/(${SIDE_EFFECTING_SEGMENTS.join("|")})/?$`,
  "i",
);

export function isSideEffecting(method: HttpMethod, path: string): boolean {
  if (WRITE_METHODS.includes(method)) return true;
  // Query string first: `/email?foo=1` is the same dispatch as `/email`.
  return SIDE_EFFECTING_PATH.test(path.split("?")[0]);
}

export function normalisePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Path is required, e.g. /3/customers");
  // Accept a pasted absolute URL as well as a bare path — you will paste both
  // straight out of the vendor's docs, and having one silently 404 is friction
  // for no reason.
  if (trimmed.startsWith(BASE_URL)) return trimmed.slice(BASE_URL.length);
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed;
}

/**
 * Reproduce a call outside the app.
 *
 * The token is never interpolated — you get a $VENDOR_TOKEN placeholder — so a
 * curl command pasted into a chat or an issue is not a credential leak.
 *
 * There is no `body` parameter. It used to take one, left over from when this
 * app could be armed to write, and both call sites passed a GET and nothing
 * else — so the branch that emitted `-d` was unreachable. A curl builder that
 * can still assemble a request body for a permanently read-only lab is exactly
 * the vestigial write surface docs/standard.md rule 7 says to delete rather than
 * guard.
 */
export function toCurl(method: string, path: string): string {
  return [
    `curl -X ${method} '${BASE_URL}${path}'`,
    `  -H "Authorization: Bearer $VENDOR_TOKEN"`,
    `  -H 'Accept: application/json'`,
  ].join(" \\\n");
}
