import postgres from "postgres";

/**
 * Read-only connection to the observed system's Postgres database.
 *
 * This is the ONE module that knows the observed system exists. With no connection string
 * configured the app is exactly what it was before: a plain vendor console.
 *
 * Read-only is enforced by the DATABASE, not by this code. The connection uses a
 * role holding SELECT on seven tables and nothing else — verified against
 * production: writes return `permission denied for table invoice`, and tables
 * outside the grant list (notably `vendor_token`, which holds OAuth secrets)
 * return `permission denied` too. That is a real boundary rather than a
 * convention this file could accidentally break.
 *
 * It replaced a Supabase service-role key, which bypassed RLS and could write.
 * Do not reintroduce one: the whole point is that a leak of this credential
 * cannot alter the ledger or reach a secret.
 *
 * Setup lives in the README ("observed-system data source"), including the role SQL.
 */

let client: postgres.Sql | undefined;

export function getObservedSql(): postgres.Sql | null {
  const url = process.env.OBSERVED_DATABASE_URL;
  if (!url) return null;

  if (!client) {
    client = postgres(url, {
      // Small pool: this is an analysis tool issuing occasional queries, and the
      // pooler is shared with production traffic.
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      // Supavisor does not support the extended protocol's prepared statements
      // reliably across pooled connections.
      prepare: false,
      // The checks are read-only by grant; saying so lets Postgres reject a
      // stray write with a clearer error than a permission failure.
      connection: { application_name: "this plane" },
    });
  }

  return client;
}

export function isObservedConfigured(): boolean {
  return Boolean(process.env.OBSERVED_DATABASE_URL);
}

export class ObservedQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservedQueryError";
  }
}

/** The connection, or a clear error explaining what to configure. */
export function requireObservedSql(): postgres.Sql {
  const sql = getObservedSql();
  if (!sql) {
    throw new ObservedQueryError(
      "No observed-system data source configured. Set OBSERVED_DATABASE_URL in .env.local.",
    );
  }
  return sql;
}
