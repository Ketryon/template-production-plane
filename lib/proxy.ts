import { recordCall } from "./store";
import { getSourceAccessToken } from "./observed/sources";
import { BASE_URL, isSideEffecting, normalisePath } from "./http";
import { reserveSlot } from "./rate-budget";

/**
 * The single path every the vendor call in this app takes — the catalog operations,
 * the reconcile checks and the console all come through here.
 *
 * One executor means one place where auth, the 401 recovery, timing and logging
 * happen, so the history log is a complete record of what this tool has sent.
 *
 * THIS APP IS READ-ONLY AGAINST FORTNOX, and this function is where that is
 * true rather than merely intended. It borrows the observed system's production access
 * token, so there is no version of "arm it and write" that would be safe — the
 * guard below is absolute and has no toggle.
 */

export interface CallInput {
  sourceId: string;
  path: string;
}

export interface CallResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  /** Parsed when the response was JSON, otherwise the raw text. */
  body: unknown;
  /** True when the payload was not JSON — /preview returns PDF bytes, and some
   *  infrastructure errors come back as HTML. */
  raw: boolean;
  error: string | null;
  /**
   * The handful of response headers worth surfacing. Not rate-limit headers —
   * the vendor sends none (see lib/rate-budget.ts). These are the two that answer
   * real questions:
   *
   *   upstreamMs  x-rack-responsetime — time spent inside the vendor, as opposed
   *               to durationMs, which includes the network. A slow call with a
   *               fast upstreamMs is our problem, not theirs.
   *   requestId   x-uid — quote this at the vendor support. Without it a support
   *               thread starts with "which request?".
   */
  upstreamMs: number | null;
  requestId: string | null;
  /** True when the vendor refused for rate reasons. See the 429 note below. */
  rateLimited: boolean;
}

export class ReadOnlyError extends Error {
  constructor(path: string) {
    super(
      `Refused: "${path}" is not a read. This lab observes the observed system's the vendor ` +
        `integration using the observed system's own production credentials, so it only ever ` +
        `issues reads. the vendor's send and bookkeep endpoints are GET but still ` +
        `dispatch, which is why this check looks at the path and not the method.`,
    );
    this.name = "ReadOnlyError";
  }
}

/**
 * Execute one the vendor read.
 *
 * Every outcome — success, the vendor error, thrown failure — is written to the
 * call log before returning. A failed call is exactly the one worth finding
 * again later, so the log must not be success-only.
 */
export async function callVendor(input: CallInput): Promise<CallResult> {
  const path = normalisePath(input.path);

  // The one invariant. `isSideEffecting` keys on the PATH because the vendor's
  // /email, /einvoice, /eprint and /bookkeep endpoints are GET yet dispatch to
  // real customers — a method-based check would have a hole big enough to mail
  // an invoice through. Everything is issued as GET below regardless.
  if (isSideEffecting("GET", path)) {
    throw new ReadOnlyError(path);
  }

  const url = `${BASE_URL}${path}`;
  const started = Date.now();

  const send = (accessToken: string) =>
    fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // the vendor keys error-message formatting off Accept, including on binary
        // endpoints like /preview, so it is always application/json here.
        Accept: "application/json",
      },
    });

  let status: number | null = null;
  let payloadText = "";
  let error: string | null = null;
  let parsed: unknown = null;
  let raw = false;
  let upstreamMs: number | null = null;
  let requestId: string | null = null;
  let rateLimited = false;

  try {
    // Wait for the lab's share of the vendor's tenant-wide quota before sending.
    // The token is production's, so the allowance is production's too.
    await reserveSlot();

    let response = await send(await getSourceAccessToken(input.sourceId));

    // Recovery is a RE-READ, never a refresh: the observed system's renewer rotates the
    // token roughly every 15 minutes, and refreshing here would invalidate the
    // pair production is using.
    if (response.status === 401) {
      await reserveSlot();
      response = await send(await getSourceAccessToken(input.sourceId));
    }

    status = response.status;

    const rackTime = Number(response.headers.get("x-rack-responsetime"));
    upstreamMs = Number.isFinite(rackTime) && rackTime > 0 ? rackTime : null;
    requestId = response.headers.get("x-uid");

    // 429 is TERMINAL here, deliberately — no retry, no backoff-and-try-again.
    //
    // The usual advice is exponential backoff, and that is right for the
    // production integration, which has work that must eventually complete. It
    // is wrong for this lab. A 429 means the shared tenant budget is already
    // exhausted, and the most likely reason is that production is mid-run. A
    // tool that retries at that moment is competing harder with the system it
    // was built to diagnose, not less. Stop, say so, and let a human choose to
    // run it again later.
    if (response.status === 429) {
      rateLimited = true;
      const retryAfter = response.headers.get("retry-after");
      error =
        `the vendor rate limit reached (429)${retryAfter ? `, retry after ${retryAfter}s` : ""}. ` +
        `This quota is shared with the production integration — the lab does not retry, ` +
        `because retrying now competes with whatever exhausted it. Try again shortly.`;
    }

    payloadText = await response.text();

    if (payloadText) {
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        parsed = payloadText;
        raw = true;
      }
    }

    // The 429 message above is more useful than the vendor's own body, so it wins.
    if (!response.ok && !rateLimited) {
      error = describeVendorError(parsed, response.status);
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const durationMs = Date.now() - started;

  await recordCall({
    sourceId: input.sourceId,
    method: "GET",
    path,
    status,
    responseBody: payloadText || null,
    durationMs,
    error,
  });

  return {
    ok: status !== null && status >= 200 && status < 300,
    status,
    durationMs,
    body: parsed,
    raw,
    error,
    upstreamMs,
    requestId,
    rateLimited,
  };
}

/**
 * Pull a readable message out of a the vendor error payload.
 *
 * the vendor is inconsistent about casing and nesting across its API generations —
 * `ErrorInformation.Message` on /3, lowercase `message` elsewhere, sometimes a
 * bare `error` string. Surfacing the wrong one leaves you staring at "Unknown
 * error" while the real cause sits two keys away in the response viewer.
 */
function describeVendorError(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();

  const body = payload as
    | {
        ErrorInformation?: {
          Message?: string;
          message?: string;
          Code?: number;
          code?: number;
          Error?: number;
        };
        message?: string;
        error?: string;
        error_description?: string;
      }
    | null
    | undefined;

  const info = body?.ErrorInformation;
  const message =
    info?.Message ??
    info?.message ??
    body?.error_description ??
    body?.message ??
    body?.error;

  const code = info?.Code ?? info?.code ?? info?.Error;

  if (message && code) return `${code}: ${message}`;
  if (message) return message;
  return `the vendor returned HTTP ${status}`;
}
