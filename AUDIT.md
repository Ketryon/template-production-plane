# template-production-plane — audit and open decisions

Audit of the template on 2026-08-11, immediately after extracting it from a
working plane. Everything listed here was verified against the code at the time
of writing, not inferred. Items fixed in the same pass are recorded at the bottom
so this reads as a history rather than a permanent backlog.

**Health at time of audit:** 37 files, 1 689 lines of TypeScript, `pnpm verify`
clean (typecheck + eslint + 79 tests), `next build` clean, app boots and fails
closed unconfigured.

> **The cheapest smoke test for this template** is to delete one entry from
> `SIDE_EFFECTING_SEGMENTS` in `lib/http.ts` and run `pnpm test`. It must fail
> with 8 named failures. If it passes, the guard is no longer guarded — and the
> guard is the one thing here whose failure is irreversible.

---

## Open — decisions, not defects

### 1. Unused exports kept deliberately

`toCurl`, `windowUsage`, `estimateSeconds` and `listSources` are exported and
have no consumer in the template, because the UI that used them was not ported.

Kept rather than pruned, on the argument that they are the API surface a new
plane will want and deleting them means the next person rediscovers the need
from scratch. `README.md` names them under *What this deliberately does not
include*, with the note that showing a run's cost **before** it starts is the
part not to skip.

The counter-argument is real: a template that carries unused code teaches that
unused code is acceptable. If that lands badly the first time someone uses this,
prune them and delete this section.

### 2. No UI, and no view over the catalog

`app/login` and `app/(app)/page.tsx` are stubs, and nothing renders
`lib/catalog.ts`. Deliberate — the surfaces worth building are per-plane, and a
half-styled one invites someone to keep it.

The risk is that `lib/catalog.ts` is the most valuable idea in the shape and the
easiest to skip, precisely because nothing displays it. If a second plane ships
without a catalog view, that is the signal to reconsider and ship a minimal one.

### 3. Git history contains the pre-genericisation names

The first commit shipped with `FORTNOX_*` constants and two real role names in
`docs/standard.md`, fixed in `ec9f3e1`. The repo is public, so the history
retains them.

Severity is low — no credentials, hosts or keys, only a vendor name and internal
role naming. Left as-is rather than force-pushing a public template. Recorded
here so the decision is visible rather than accidental.

### 4. Rule 4 will be `partial` for most planes

`docs/standard.md` rule 4 asks for credentials that are *short-lived*, not merely
rotatable. Static database passwords are not, however diligently rotated. Any
plane using a plain connection string starts at `partial` on that rule, and the
honest paths are a written rotation cadence or dynamic short-lived credentials
from a broker.

This is not a defect in the template. It is recorded so nobody marks the rule
`pass` on the strength of having rotated once — which is exactly what the worked
example in `docs/standard.md` warns against.

---

## Fixed in this pass

### The template broke its own setup instructions

`lib/__tests__/rate-budget.test.ts` asserted the exact published limits of the
vendor it was extracted from (`toBe(25)`, `toBe(5_000)`). Step 4 of the README
instructs a new plane to set its own vendor's real limit, which would have failed
the suite immediately. Now asserts the *relationship* — the plane's share stays
at or under a quarter of the vendor's — rather than two magic numbers.

### `lib/catalog.ts` was missing entirely

The README instructed the reader to add reads "as declared entries with a
mandatory note", and there was nothing to add them to. The largest gap in the
extraction, and the one hardest to notice because everything still compiled.
`note` is typed as a required string rather than an optional one, so omitting it
is a compile error.

### One system's token schema presented as generic

`lib/observed/sources.ts` hardcoded a table name and column names from the plane
this came from. Now a flagged fill-in point, with the *property* that must not
change (borrow a token production already holds) stated separately from the
*shape* that must.

### Product and vendor names survived into a public repo

The extraction substituted case-sensitively and missed everything uppercase:
`FORTNOX_WINDOW_MS`, `FORTNOX_LIMIT_PER_WINDOW`, a `$FORTNOX_TOKEN` placeholder,
and `READ-ONLY AGAINST FORTNOX` in a header comment. `docs/standard.md` was
worse, carrying two real role names, real repo paths and a dated rotation.

Renamed throughout; the two instance-specific sections of the standard were
rewritten as worked examples of recording a `constrained` and a `partial`
verdict, which is more useful than the specifics were.

**Third time in the same session a blind string substitution broke something no
compiler could see** — all of it inside comments. Substitute on word boundaries,
then read the diff.

### Tailwind configured but unused

`postcss.config.mjs` and the Tailwind dependencies shipped with no stylesheet and
no import. Wired with a minimal `app/globals.css` rather than removed, since
`postcss.config.mjs` is the convention across the sibling templates in this org.

### Missing org conventions

`.prettierrc` and `renovate.json` are carried by every other `template-*` repo in
the org and were absent here.

---

## Verified clean

Checked and found nothing wrong, recorded so the next audit can skip them or
confirm they have not regressed:

- **Every import resolves.** No dangling `@/` paths left by the re-homing of
  `lib/worknode/` to `lib/observed/`.
- **Env vars match the code exactly.** Every variable in `.env.example` is read
  somewhere, and every `process.env.*` read is declared. No extras, no gaps.
- **No dangling documentation references.** Every file path named in `README.md`,
  `docs/standard.md` and `migrations/README.md` exists.
- **The middleware matcher covers `/api`.** Verified by request, not by reading:
  unconfigured, the app 307s to `/login` on `/`, on a gated page, *and* on
  `/api/call`. The API being gated is the property most easily lost when someone
  adapts the matcher.
- **The guard's tripwire fires in this repo**, not only in the one it came from.
- **No `eslint-disable` anywhere.**
- **`migrations/`'s own CI checks pass against the template's example
  migrations** — header block, ledger agreement, and the rule that migrations
  against the observed system contain no DML.
