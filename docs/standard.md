# The standard a production plane is built to

A production plane is not a sandbox, and calling it one hides the thing that makes it
safe.

A sandbox **isolates the data** — a separate environment, seeded records, fake
credentials. This isolates the **effect**: real environment, real data, real
production credentials, and no authority to change anything. Those are different
axes, and the second one is the harder and more useful property.

|                       | Isolates data | Isolates effect       |
| --------------------- | ------------- | --------------------- |
| Staging / sandbox     | yes           | no — you write freely |
| Read replica          | no            | for one database      |
| Admin panel           | no            | no                    |
| **A production plane** | no, by design | across every system  |

The name for it, used throughout this doc: a **read-only production plane**.

> A separately deployed tool that observes one or more production systems and
> cannot change any of them. It holds no standing authority of its own; every
> credential is derived from a system it observes and is strictly weaker than
> that system's own. Mutation is unexpressible in its API surface, not merely
> refused. Read-only is enforced at a boundary the tool's own code cannot alter.

---

## Why there is no off-the-shelf standard to point at

There isn't one. Platform engineering's "observability" means telemetry
pipelines, not reading the business database. Read replicas cover one system,
not the gap between two. Everything filed under "sandbox" assumes a fake
environment.

What exists is the **five standards this is a composition of**. Standardise
against those rather than inventing a pattern name and hoping it carries meaning
to the next person:

| # | Standard | What it governs here |
|---|---|---|
| 1 | **Zero Standing Privilege** (Gartner; JIT PAM) — just enough access, just in time, time-bound | Every credential this plane holds |
| 2 | **RFC 8693 OAuth 2.0 Token Exchange** — downscoping, the `act` delegation claim | How authority is *borrowed* |
| 3 | **Capability security / POLA**; "make illegal states unrepresentable" (Minsky); the **confused deputy** problem (Hardy) | The shape of this plane's own API |
| 4 | **RFC 9110 §9.2.1** — safe methods; safety is the *origin server's* property, not inferable from the verb | The read-only guard |
| 5 | **GDPR Art. 5(1)(b–c)** purpose limitation + data minimisation; **SOC 2 CC6** logical access | What leaves production, and who gets in |

Rule 3 is worth internalising beyond the citation. A tool that holds
production's authority and applies it to caller-supplied input **is a confused
deputy** — it conflates the authority to act with the designation of what to act
on. That framing tells you exactly what to review: every place caller input
meets borrowed authority. In this app that is two places, `path` in
`/api/call` and `checkId`/`sourceId` in `/api/reconcile`, and nothing else.

---

## The ten rules

| #  | Rule                                                              | From | Today |
| -- | ----------------------------------------------------------------- | ---- | ----- |
| 1  | No user directory of its own; authorise against the observed system | 5    | — |
| 2  | No credential of its own; every one borrowed                       | 1    | — |
| 3  | Every borrowed credential **strictly weaker** than its source      | 2    | — |
| 4  | Credentials rotatable and short-lived; blast radius written down   | 1    | — |
| 5  | Read-only enforced outside the app's own code                      | 1    | — |
| 6  | Unsafe endpoints enumerated by **path**, and tested                | 4    | — |
| 7  | Mutation unexpressible in the API shape                            | 3    | — |
| 8  | Every byte leaving production declared, minimised, retention-bounded | 5  | — |
| 9  | Unconfigured means locked, never open                              | 5    | — |
| 10 | Its own load isolated from production's                            | —    | — |

**Score it before you ship, and again when anything operational changes.** Every
rule is `—` until someone has checked it against the running system rather than
against intent.

Four verdicts, and the difference between the last two is the whole point:

| | |
|---|---|
| `pass` | Met, and verified against the live system. |
| `partial` | Some clauses met. Name which are not, precisely. |
| `constrained` | **Cannot** be met here — a platform or vendor limit no design of yours can fix. Requires a citation and named compensating controls. |
| `fail` | Not met, and could be. This is work, not a verdict. |

`constrained` is not a softer word for `fail`, and using it as one destroys its
value. It exists because a standard that can only say *fail* teaches the next
team to contort a working architecture chasing a green tick — and **a conformance
rule is not worth more than the property it was written to protect.**

Score honestly. An earlier version of this table in the repo it came from read
"eight of ten" for three straight revisions because it counted a `partial` as a
`pass`. A score that rounds up flatters itself, which is the failure mode this
document exists to prevent.

### Worked example — recording a `constrained` rule

From the plane this template came from, kept because the shape is what matters.

Rule 3 wants the borrowed credential to be strictly weaker than its source. For
identity and data access it was: an admin session with no elevated grant, and a
role holding `SELECT` on ten tables. For the vendor's API token it could not be,
and the vendor said so plainly:

> All scopes gives both read and write access to an endpoint and it is not
> possible to only have read access through the API.

Scopes were all-or-nothing. Registering a second application for the plane would
have obtained a credential with *identical* power, so it bought nothing, and
there was no weaker scope to downscope to. That is `constrained`, not `fail`:

1. **The citation.** Quote the vendor or platform. Without it this is an excuse.
2. **Why no design fixes it.** Enumerate the options and why each fails.
3. **The compensating controls.** What you do instead — rotation, a written
   blast radius, deployment protection, keeping the app's own code unable to
   write.
4. **What would change the verdict.** Here: the vendor introducing read-only
   scopes.

### Worked example — recording a `partial` rule

Also from that plane, because `partial` gets misused as "nearly done" when it
should mean "name exactly which clauses are unmet".

Rule 4 has three clauses. Two were met: the credentials were demonstrably
**rotatable** (rotated, with a rollback path — the old session held open, since a
role's existing sessions survive its password changing, reverting automatically
if the new credential failed to authenticate or came back with different
privileges), and the **blast radius was written down**.

**Short-lived was not met**, and the rule stayed `partial` rather than being
marked `pass` when the rotation landed. Both credentials were static passwords
with no expiry, and rotating one by hand is not the same property as a credential
that expires on its own — which is what zero standing privilege actually asks
for. One rotation resets the clock; it does not start one.

Closing it costs, in ascending order: a written rotation cadence with a reminder
(cheapest, and most of the value at two credentials), or dynamic short-lived
credentials from a broker (the real answer, disproportionate for a single plane,
worth revisiting at three or four).

The point is the discipline: **do not upgrade a verdict because the task that was
outstanding got done.** Check every clause.

### Where each rule lives

| Rule | File |
| ---- | ---- |
| 1, 9 | [`lib/auth.ts`](../lib/auth.ts), [`middleware.ts`](../middleware.ts) |
| 2, 3, 4 | [`lib/observed/sources.ts`](../lib/observed/sources.ts), [`migrations/observed/`](../migrations/observed) |
| 5 | [`migrations/observed/`](../migrations/observed) for the observed system's database and [`migrations/own/`](../migrations/own) for this plane's store. Both are grants, applied by hand. Deliberately not enforced by any code in this repo. |
| 6 | `isSideEffecting` in [`lib/http.ts`](../lib/http.ts), pinned by [`lib/__tests__/http.test.ts`](../lib/__tests__/http.test.ts) |
| 7 | [`app/api/call/route.ts`](../app/api/call/route.ts) |
| 8 | `RETENTION_DAYS` and `sweepExpired` in [`lib/store.ts`](../lib/store.ts) |
| 10 | [`lib/rate-budget.ts`](../lib/rate-budget.ts), the 429 branch in [`lib/proxy.ts`](../lib/proxy.ts), and the page ceiling on any paginated sweep you add |

---

## Setting up a new plane

Work these in order. Each is independently shippable, and the ordering is by risk
reduced per hour rather than by severity — so nothing sits half-done.

### 1. Say what is true

Before any hardening, write down what the plane's credentials actually reach, in
the README, in plain terms. Every later decision is a judgement call someone has
to justify, and they cannot justify it against a document that says the problem
does not exist.

**Done when:** someone who reads only the README arrives at the same threat model
as someone who reads the code.

### 2. Pin the guard

Fill in `SIDE_EFFECTING_SEGMENTS` in `lib/http.ts` for your vendor, and make the
test in `lib/__tests__/http.test.ts` assert its exact contents. Then **verify the
tripwire fires** — delete an entry locally and confirm the suite goes red by
name. An untested guard is a guess.

Test the deliberate *exclusions* too. An untested exclusion is indistinguishable
from an oversight, and an over-tight guard produces a tool nobody can use.

**Done when:** deleting any entry from the list fails CI.

### 3. Bound the data

Decide the retention window in `lib/store.ts` and make sure the sweep actually
runs. Measure before truncating response bodies — in the original, a planned cut
from 20 KB to 4 KB was dropped after finding 14% of real bodies exceeded it and
the viewer parses them as JSON.

Then drop the app off the database owner onto a role with `SELECT, INSERT,
DELETE` on the log and no `CREATE`. `ensureSchema()` already tolerates the
missing privilege.

**Done when:** no row older than the window exists, and the app's role cannot
`CREATE`.

### 4. Bound the resource

A borrowed credential shares the source's quota. Set `LAB_LIMIT_PER_WINDOW` in
`lib/rate-budget.ts` to a small fraction of the vendor's documented limit, cap
paginated sweeps, and declare each expensive operation's call count in the UI
*before* it runs.

Treat 429 as terminal. Backoff is right for a production integration that must
complete its work; it is wrong here, where a 429 usually means production is
mid-run and retrying competes harder with the thing you are diagnosing.

**Done when:** an expensive run states its cost before it starts, and a 429 stops
it rather than escalating it.

### 5. Score the table

Fill in the verdict column. Anything `constrained` gets the four-part treatment
above. Anything `fail` is work; put it on a list.

---

## Two steps worth not taking

Both were planned in the original, built or specified, then dropped. They are
here because the reasoning generalises and the instincts behind them are common.

**Moving a credential behind an indirection that does not narrow it.** Putting a
borrowed token behind a `SECURITY DEFINER` function instead of a table grant
changed `SELECT token FROM ...` into `SELECT get_token(...)`. Same holder, same
credential, same power — in exchange for a permanent new object in a production
database, and a trap that existed only because of the change (on a platform that
exposes a schema over HTTP, such a function is callable by the anonymous role).
*State what an attacker can do before and after. If the two are identical, it is
ceremony.*

**Routing every vendor call through the production application** so the plane
holds no vendor credential. This does reduce the blast radius — but measure it:
afterwards, a leak of the plane's database credential still yields an unfiltered
read of production, which is already the breach. And it trades away the property
the plane exists for. A plane that depends on the production system being healthy
goes dark exactly when someone reaches for it. *Independence is not a nice-to-have
here; it is the deliverable.*

---

## Reviewing a change against this

Four questions. If a pull request touches `lib/proxy.ts`, `lib/http.ts`,
`lib/auth.ts`, `middleware.ts` or anything under `migrations/`, answer them in
the description:

1. **Does this widen what the plane can do, or only what it can see?** Widening
   what it sees is routine. Widening what it does needs a rule number.
2. **Does any caller-supplied value now reach production authority by a new
   path?** That is the confused-deputy surface. Keep it countable.
3. **Does anything new leave production, and where does it land?**
4. **What does this cost production?** Calls, connections, quota.
