import postgres from "postgres";

/**
 * The call log, and nothing else.
 *
 * NO SECRETS, BUT PERSONAL DATA. It used to hold the vendor connections and their
 * OAuth token pairs; it no longer does, because the lab reads the observed system's own
 * `vendor_token` row rather than obtaining a grant of its own. But
 * `response_body` is whatever the vendor returned, and a customer or invoice read
 * returns names, addresses, organisation numbers and invoice lines. That makes
 * this database a SECOND processing location for the observed system's production personal
 * data, which is why it has a retention period — see RETENTION_DAYS below.
 *
 * Postgres rather than the SQLite file it started as, because serverless hosts
 * have an ephemeral filesystem — a SQLite log would be silently discarded
 * between invocations, which is worse than no log at all: the page would still
 * render and simply look empty.
 *
 * Unconfigured, every function is a no-op rather than a throw. Losing history is
 * not a reason to break every read the app can otherwise still do.
 */

let client: postgres.Sql | undefined;
let schemaReady: Promise<void> | undefined;
let warnedUnconfigured = false;
let lastSweep = 0;

/**
 * How long a logged response body is kept.
 *
 * Thirty days is long enough to answer "what did the vendor return when this went
 * wrong last month" and short enough that a copy of production personal data is
 * not accumulating indefinitely in a database that is not the observed system's.
 */
export const RETENTION_DAYS = 30;

/** At most one sweep per process per hour. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Maximum stored response body.
 *
 * Measured over the first 335 calls before this was tuned: median 3 080 chars,
 * p95 6 349, largest 20 025. Only two rows had ever hit the cap.
 *
 * An earlier plan cut this to 4 000 on data-minimisation grounds. Measuring
 * killed it: 14% of rows exceed 4 000, the History page feeds `response_body`
 * straight into the JSON viewer, and a truncated body is no longer parseable —
 * so the saving would have broken the one feature this table exists for, one
 * entry in seven. Retention bounds the exposure; the cap only bounds row size.
 */
const MAX_BODY_CHARS = 20_000;

export function clipBody(value: string | null): string | null {
  if (value === null || value.length <= MAX_BODY_CHARS) return value;
  return `${value.slice(0, MAX_BODY_CHARS)}\n… [truncated ${value.length - MAX_BODY_CHARS} chars]`;
}

export interface CallLogRow {
  id: number;
  source_id: string | null;
  method: string;
  path: string;
  status: number | null;
  response_body: string | null;
  duration_ms: number;
  error: string | null;
  created_at: string;
}

function sql(): postgres.Sql | null {
  const url = process.env.PLANE_DATABASE_URL;
  if (!url) {
    if (!warnedUnconfigured) {
      console.warn("[store] PLANE_DATABASE_URL is unset — calls will not be logged.");
      warnedUnconfigured = true;
    }
    return null;
  }
  if (!client) {
    client = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 15, prepare: false });
  }
  return client;
}

/**
 * Create the table on first use.
 *
 * Memoised as a promise rather than a boolean so concurrent requests during a
 * cold start await the same statement instead of racing to run it — otherwise
 * the first request after a deploy fires a burst of duplicate CREATEs.
 */
function ensureSchema(db: postgres.Sql): Promise<void> {
  schemaReady ??= (async () => {
    try {
      await createSchema(db);
    } catch (error) {
      // insufficient_privilege. Expected, and fine: it means the app is running
      // as the least-privilege role, which holds INSERT/SELECT/DELETE on
      // call_log and no CREATE — so the schema is owned by
      // migrations/lab/ rather than bootstrapped here, which is the intended
      // end state. Anything else is a real failure and propagates.
      if ((error as { code?: string })?.code !== "42501") throw error;
    }
  })();
  return schemaReady;
}

/**
 * Bootstrap the schema on first use.
 *
 * Kept, rather than deleted in favour of the migration, so `git clone` +
 * `pnpm dev` against an empty database still works. The migration is the
 * reviewable source of truth; this is the convenience path, and the two must
 * not drift — change both in the same commit.
 */
async function createSchema(db: postgres.Sql): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS call_log (
      id            bigserial PRIMARY KEY,
      source_id     text,
      method        text NOT NULL,
      path          text NOT NULL,
      status        integer,
      response_body text,
      duration_ms   integer NOT NULL DEFAULT 0,
      error         text,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_call_log_recent ON call_log (id DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_call_log_created_at ON call_log (created_at)`;
}

/**
 * Delete anything past the retention window.
 *
 * Deliberately not a cron. This is a low-traffic internal tool; a scheduled job
 * for one DELETE is a moving part with its own failure mode, and a sweep that
 * runs whenever the app is used is enough for a 30-day window.
 *
 * Throttled per process rather than folded into ensureSchema(), which is
 * memoised and therefore runs its body exactly once per process — on a
 * long-lived instance that would sweep at boot and then never again. An hourly
 * check makes the guarantee real instead of incidental.
 *
 * The index this relies on is migrations/lab/20260811134500_call_log_retention.sql.
 * Without it the DELETE still works, just as a sequential scan.
 */
async function sweepExpired(db: postgres.Sql): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  // Set before awaiting: two concurrent requests should not both sweep.
  lastSweep = now;

  try {
    const deleted = await db`
      DELETE FROM call_log
       WHERE created_at < now() - make_interval(days => ${RETENTION_DAYS})
    `;
    if (deleted.count > 0) {
      console.log(`[store] retention: deleted ${deleted.count} row(s) older than ${RETENTION_DAYS} days`);
    }
  } catch (error) {
    // Same reasoning as recordCall's catch: retention failing must not turn a
    // successful the vendor read into an error. It will be retried in an hour.
    console.error("[store] retention sweep failed:", error);
  }
}

export async function recordCall(entry: {
  sourceId: string | null;
  method: string;
  path: string;
  status: number | null;
  responseBody: string | null;
  durationMs: number;
  error: string | null;
}): Promise<void> {
  const db = sql();
  if (!db) return;

  try {
    await ensureSchema(db);
    await db`
      INSERT INTO call_log (source_id, method, path, status, response_body, duration_ms, error)
      VALUES (${entry.sourceId}, ${entry.method}, ${entry.path}, ${entry.status},
              ${clipBody(entry.responseBody)}, ${entry.durationMs}, ${entry.error})
    `;
    // After the insert, never before: recording the call is the job, and
    // retention must not be able to cost us the row we came here to write.
    await sweepExpired(db);
  } catch (error) {
    // Logging is observability, not the job. A log-write failure must never turn
    // a successful the vendor read into an error the caller sees.
    console.error("[store] failed to record call:", error);
  }
}

export async function listCalls(limit = 100): Promise<CallLogRow[]> {
  const db = sql();
  if (!db) return [];
  await ensureSchema(db);
  return db<CallLogRow[]>`
    SELECT id, source_id, method, path, status, response_body, duration_ms, error, created_at
      FROM call_log
     ORDER BY id DESC
     LIMIT ${limit}
  `;
}

export async function clearCalls(): Promise<void> {
  const db = sql();
  if (!db) return;
  await ensureSchema(db);
  await db`DELETE FROM call_log`;
}
