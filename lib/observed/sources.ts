import { getObservedSql } from "./client";

/**
 * the vendor "sources" — the companies the observed system is connected to.
 *
 * A source is not a connection this app owns. It is a read of the observed system's
 * `vendor_token` row: the same access token the observed system's own integration is using
 * right now. That is the point of the lab — to watch the live interaction, not
 * to hold a parallel grant beside it.
 *
 * Two consequences fall out, and both are deliberate:
 *
 *   1. THIS APP NEVER REFRESHES. the vendor refresh tokens are single-use and
 *      rotate; refreshing here would invalidate the pair the observed system depends on,
 *      and writing the replacement back would need UPDATE on `vendor_token` —
 *      which the read-only role deliberately withholds. the observed system's
 *      `vendor-token-renew` cron calls itself "the single designated renewer",
 *      runs every 15 minutes and renews within 20 minutes of expiry, so the
 *      stored token is effectively always live. On a 401 we re-read the row.
 *
 *   2. There is no OAuth flow in this app at all, and no the vendor client id or
 *      secret in its environment. Nothing here can obtain a credential; it can
 *      only borrow one that already exists.
 */

export interface ObservedSource {
  /** The the observed system legal entity id. */
  id: string;
  label: string;
  /** Expiry of the access token the observed system currently holds. */
  expiresAt: string;
}

export async function listSources(): Promise<ObservedSource[]> {
  const sql = getObservedSql();
  if (!sql) return [];

  try {
    // Never select access_token here — this list is serialised to the browser
    // and only needs to know which entities exist.
    const rows = await sql<{ legal_entity_id: string; expires_at: string }[]>`
      select legal_entity_id, expires_at
        from vendor_token
       order by legal_entity_id
    `;

    return rows.map((row) => ({
      id: row.legal_entity_id,
      label: `the observed system · ${row.legal_entity_id.slice(0, 8)}`,
      expiresAt: row.expires_at,
    }));
  } catch {
    // A data source configured without SELECT on vendor_token is a valid
    // setup — the reconcile checks still work. Only the the vendor half goes dark.
    return [];
  }
}

/**
 * The access token the observed system currently holds for this entity.
 *
 * Read fresh on every call rather than cached: the observed system's cron rotates this row
 * roughly every 15 minutes, and a cached value would be the one thing capable of
 * turning a healthy source into a 401.
 */
export async function getSourceAccessToken(sourceId: string): Promise<string> {
  const sql = getObservedSql();
  if (!sql) {
    throw new Error("No the observed system data source configured — cannot reach the vendor.");
  }

  const rows = await sql<{ access_token: string }[]>`
    select access_token
      from vendor_token
     where legal_entity_id = ${sourceId}
     limit 1
  `;

  const token = rows[0]?.access_token;
  if (!token) {
    throw new Error(`the observed system has no the vendor token for legal entity ${sourceId}.`);
  }
  return token;
}
