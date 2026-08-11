/**
 * Replace this with a real magic-link form.
 *
 * Deliberately left as a stub: the login UI is per-plane, and shipping a
 * half-styled one invites someone to keep it. What must NOT change is what sits
 * behind it — middleware.ts gates every route, and the (app) layout does the
 * admin check. See README.md.
 */
export default function LoginPage() {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      <p>
        Wire a magic-link form to the observed system&apos;s auth project here.
        Access is gated on that system&apos;s own admin flag — this app keeps no
        user list of its own.
      </p>
    </main>
  );
}
