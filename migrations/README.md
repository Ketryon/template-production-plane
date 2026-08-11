# Migrations

Two databases, two different relationships, one folder each.

| Folder | Database | Who owns it | Applied by |
| --- | --- | --- | --- |
| [`observed/`](./observed) | the observed system's production database | **Not us.** We are a guest with a read-only role. | A human, as a superuser or owner, by hand |
| [`own/`](./own) | This plane's call log (`PLANE_DATABASE_URL`) | Us | A human — `psql`, the Neon console, or any owner connection |

Neither folder is applied automatically, and there is no migration runner. That
is deliberate for `observed/` — a tool whose entire premise is that it cannot
change production must not ship something that changes production — and it is
proportionate for `own/`, which is one table.

**The repo is the ledger.** With no runner there is no
`schema_migrations` table to consult, and we will not create one in a database
we do not own. Each file's header records whether it has been applied and when;
[`_applied.md`](./_applied.md) is the same information on one page.

---

## Rules

**1. Filename is `YYYYMMDDHHMMSS_snake_case_description.sql`, UTC.**
Same convention as the Supabase CLI and as a real repo in this estate's 91 migrations, so
there is one convention across the estate rather than one per repo. The
timestamp both orders the files and avoids the collisions a sequential counter
produces when two branches add a migration.

**2. Every file is idempotent, and says why.** Re-running it must be a no-op,
not an error — there is no runner tracking what has already been applied, so the
only safe migration is one you can paste twice. `CREATE OR REPLACE`,
`IF NOT EXISTS`, or simply being a `GRANT` block, which is idempotent by
construction. The `Idempotent:` header states which; CI checks it is filled in,
and the reviewer judges whether it is true.

**2b. Roles and passwords are not migrations.** `CREATE ROLE ... PASSWORD` would
put a credential in git, so role creation and rotation happen in the Supabase SQL
editor and are recorded in the password manager. What belongs here is what that
role may *see* — the part with a blast radius and the part worth a diff.

**3. Never edit a file marked applied.** Write a new one. An edited migration is
a file whose name claims one thing and whose contents do another, and the next
person to read it has no way to know which version ran.

**4. Every file carries this header, and CI checks that it does:**

```sql
-- Migration: what it does, in a line
-- Target:    which database
-- Applies as: which role, through which tool
-- Applied:   YYYY-MM-DD  |  NOT YET APPLIED
-- Rollback:  the exact statements, or why there are none
-- Verify:    a query, and what it should return
```

`Rollback` is not optional and "restore from backup" is an acceptable answer —
but it has to be written down before the change, not discovered during the
incident. Reviewers read the rollback line before the SQL.

**5. Grants, functions and views are declared end-states, not deltas.**
Flyway calls these *repeatable* migrations. Write them as the full desired
state with `CREATE OR REPLACE` / a complete `GRANT` block, so the newest file
for an object is the whole truth about it and you never have to replay a chain
to know what the permissions are.

**6. Exactly one migrations directory.** If you see `migrations 2/`, something
copied the folder — delete it, do not merge it. a real repo in this estate carries 37
foundational migrations, including its `init.sql`, in a `supabase/migrations 2/`
directory the Supabase CLI has never read, so that repo cannot rebuild its own
database. CI here fails on any directory that is not `observed/` or `own/`.

---

## Rules for migrations we do not have yet

Nothing here touches a large table or a hot path. When something does:

- **Set timeouts on the session first** — `SET lock_timeout = '2s'; SET
  statement_timeout = '30s';` — so a blocked migration fails fast instead of
  queueing every request behind it.
- **`CREATE INDEX CONCURRENTLY`**, which cannot run inside a transaction block.
- **Backfill in batches** of ≤100k rows. One `UPDATE` over the whole table holds
  the lock as long as the DDL you were avoiding.
- **`ADD CONSTRAINT ... NOT VALID`** then `VALIDATE CONSTRAINT` separately: the
  first is instant, the second takes a weaker lock than doing it in one step.
- **Expand / migrate / contract** for anything breaking — add the new shape,
  move the readers, then remove the old shape, as three deployable changes
  rather than one.

## Applying one

1. Read the `Rollback` line. If you would not be willing to run it, stop.
2. Open the target database — Supabase SQL editor as `postgres` for
   `observed/`, `psql` for `own/`.
3. Paste the file whole. Every file is written to be run whole.
4. Run the `Verify` query and check it returns what the header says.
5. Change `Applied: NOT YET APPLIED` to the date, update
   [`_applied.md`](./_applied.md), and commit that in the same change.

Step 5 is the one that gets skipped, and skipping it is how the ledger stops
being true.
