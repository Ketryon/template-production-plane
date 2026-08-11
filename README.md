# Production plane — template

A **read-only production plane**: a separate, deployed application that observes
one or more production systems and cannot change any of them.

It is **not a sandbox**. A sandbox isolates the *data* — a separate environment,
seeded records, fake credentials. This isolates the *effect*: real environment,
real data, real production credentials, and no authority to change anything.
Different axis, and the harder property.

Use it when the interesting question spans two systems that each hold half the
truth — "our record says sent, theirs says nothing arrived, which is lying" —
and neither can be checked against the other from inside either one.

Read [`docs/standard.md`](docs/standard.md) before changing anything under
`lib/`. It is the whole point of this template; the code is downstream of it.
[`AUDIT.md`](AUDIT.md) records what was checked when this was extracted, what was
left open on purpose, and the cheapest way to tell whether the guard still
guards.

---

## Fill these in

Everything below is a real, running Next.js app that typechecks, lints and
passes its tests as-is. What it does not have is *your* vendor and *your*
observed system.

| # | Where | What |
|---|---|---|
| 1 | `.env.example` → `.env.local` | Connection strings and keys |
| 2 | `lib/http.ts` | `SIDE_EFFECTING_SEGMENTS` — **the most consequential edit here** |
| 3 | `lib/auth.ts` | `ADMIN_TABLE` / `ADMIN_COLUMN` for the observed system's own admin flag |
| 4 | `lib/rate-budget.ts` | The vendor's documented limit, and your fraction of it |
| 5 | `lib/observed/sources.ts` | The table and columns holding the borrowed vendor token |
| 6 | `lib/catalog.ts` | Your reads, each with a mandatory `note` |
| 7 | `migrations/observed/` | Which tables the read-only role may see |
| 8 | `docs/standard.md` | Score the table. Every rule starts at `—` |

```bash
pnpm install
cp .env.example .env.local
pnpm verify        # typecheck, lint, tests — also runs in CI
pnpm dev
```

## Copy these verbatim

Four files carry the reasoning that makes this shape safe. Change them and you
are no longer building this pattern, you are building something that resembles
it.

- **`middleware.ts`** — deny-by-default over every route including `/api`,
  failing **closed** when unconfigured. An allow-list of protected routes leaks
  every page someone forgets to add.
- **`lib/auth.ts`** — borrowed identity. No user table; gate on the observed
  system's own admin flag, so revoking there revokes here.
- **`app/(app)/layout.tsx`** — the admin check. Middleware answers *"are you
  logged in"*, cheaply, per request; this answers *"are you allowed"*, once per
  render. Neither alone is sufficient.
- **`lib/http.ts`** — the guard. Its *list* is yours; its *shape* is not.

## The five ideas

**Borrow every credential, issue none.** Identity from the observed system's
auth, data access from a `SELECT`-only role, vendor auth from the token the
production integration already holds. Every credential you issue is one more to
deprovision and one more to forget.

**Enforce read-only where this app cannot edit it.** A read-only flag in code is
a comment; a database role without `INSERT` is a boundary. The difference is the
feature someone adds in six months without reading your header.

**Write down what the vendor really does.** `lib/catalog.ts` holds every read as
data, each with a *mandatory* `note` field — for behaviour the documentation
omits and you only learn by having something go wrong. A plane with only a
free-form console is a `curl` wrapper with a login; the notes are what make it
worth keeping. `note` is a required string rather than an optional one so that
leaving it out is a compile error.

**Make the write unexpressible, not blocked.** `app/api/call/route.ts` takes a
source and a path. No method parameter, no body. There is no flag to flip and no
armed mode to add — a write cannot be *constructed*.

**Guard on what the vendor does, not what the verb says.** HTTP defines `GET` as
safe, but places that responsibility on the origin server. Real APIs violate it:
`GET /invoices/{n}/email` mails the invoice. A guard keyed on the HTTP method has
a hole big enough to mail a live customer through, which is why
`SIDE_EFFECTING_SEGMENTS` keys on the path.

## Blast radius

**Write this section for your plane, and write it before you deploy.**

The credentials here are production credentials. State plainly what each one
reaches if it leaks — not what the app does with it, what *anyone holding it*
could do. In the original, `OBSERVED_DATABASE_URL` turned out to be the
highest-value secret in the repo: an un-RLS'd read of ten tables *and* a live
vendor token that could write. The app's own guards constrained the app's code
paths and did nothing about the credential.

"This app cannot write" and "a leak of this app's environment is harmless" are
different claims. Only the first is usually true.

Then act on it: environment variables only, never a shell history, rotate on any
suspicion, and put deployment protection in front of a guessable URL.

## What this deliberately does not include

- **A UI.** `app/login` and `app/(app)/page.tsx` are stubs, and nothing renders
  `lib/catalog.ts` yet. The surfaces worth building are per-plane; a half-styled
  one invites someone to keep it. `lib/http.ts` exports `toCurl`, and
  `lib/rate-budget.ts` exports `windowUsage` and `estimateSeconds`, for whatever
  you build — showing a run's cost *before* it starts is the part not to skip.
- **Writes**, permanently.
- **A migration runner.** `migrations/` is applied by hand and the repo is the
  ledger — see [`migrations/README.md`](migrations/README.md). For the observed
  system that is the point rather than a gap: a tool whose premise is that it
  cannot change production must not ship something that changes production.

## Layout

```
middleware.ts          deny-by-default gate over every route     <- verbatim
lib/
  auth.ts              borrowed identity + the admin check       <- verbatim
  http.ts              the path guard                            <- fill the list
  proxy.ts             the one executor every call goes through
  rate-budget.ts       this plane's share of the vendor's quota
  catalog.ts           every read, as data, with a mandatory note
  store.ts             the call log, with retention
  observed/client.ts   read-only connection to the observed system
  observed/sources.ts  borrowing the vendor credential
app/api/call/route.ts  {sourceId, path} — no method, no body
migrations/
  observed/            grants on a database you are a guest in
  own/                 this plane's own store
  _applied.md          what has actually run; there is no runner
docs/standard.md       the ten rules, and how to score them
```
