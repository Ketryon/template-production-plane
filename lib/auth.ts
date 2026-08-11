import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Authentication, borrowed from the observed system exactly as the vendor token is.
 *
 * This plane keeps no user list. It authenticates against the observed system's own Supabase
 * project with the ANON key and gates on `ADMIN_TABLE.ADMIN_COLUMN = 'admin'` —
 * the same check the observed system's own admin check makes. Consequences worth stating:
 *
 *   - the accounts are the observed system's, so there is nothing to provision here
 *   - revoking someone in the observed system revokes them here, with no second step to
 *     forget about
 *   - the anon key is public by design and safe in the browser. It grants
 *     nothing on its own: every read it can make is subject to the observed system's RLS,
 *     and `ADMIN_TABLE`'s policy is
 *     `(id = auth.uid() AND deleted_at IS NULL) OR current_user_is_admin()`,
 *     so a session can only ever see its own row.
 *
 * Note the separation: this is the ONLY place the anon key and a user session
 * appear. Reading the observed system's business data goes through the read-only Postgres
 * role in lib/observed/client.ts, which has no notion of a user at all. Auth
 * decides who may open the app; it is not what fetches the data.
 */

export interface PlaneUser {
  id: string;
  email: string | null;
  name: string | null;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Cookie-backed Supabase client for server components and route handlers. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. The middleware refreshes the
            // session on every request, so it is safe to ignore here.
          }
        },
      },
    },
  );
}

/**
 * The signed-in admin, or null.
 *
 * Uses `getUser()` rather than `getSession()`: getSession trusts whatever is in
 * the cookie, while getUser revalidates the JWT with Supabase. For an
 * authorization decision, only the second is worth anything.
 *
 * The admin check reads `ADMIN_TABLE` through the user's OWN session, so
 * the observed system's RLS is what permits it. A non-admin sees only their own row and
 * simply fails the `ADMIN_COLUMN` test; there is no elevated credential involved.
 */
export async function getPlaneUser(): Promise<PlaneUser | null> {
  if (!isAuthConfigured()) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("ADMIN_TABLE")
    .select("ADMIN_COLUMN, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.ADMIN_COLUMN !== "admin") return null;

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return { id: user.id, email: user.email ?? null, name: name || null };
}
