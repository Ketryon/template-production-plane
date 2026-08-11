# Applied ledger

There is no migration runner and no `schema_migrations` table, so this file and
the `Applied:` header in each migration are the only record of what has run.
They are checked against each other in CI; they are not checked against the
database, because nothing here has permission to do that.

Update this in the same commit as the `Applied:` header. A ledger that is
updated later is a ledger nobody trusts.

## observed — the observed system's production database

| Migration | Applied | Notes |
| --- | --- | --- |
| `20260101000000_readonly_role.sql` | — | Template. Replace the table list, create the role out of band, then apply. |

## own — this plane's store

| Migration | Applied | Notes |
| --- | --- | --- |
| `20260101000000_call_log.sql` | — | Template. Also created by `createSchema()` in `lib/store.ts` as a bootstrap path; the migration is the source of truth and the two must not drift. |

## Not tracked here

Roles and passwords, deliberately — see rule 2b in [README.md](./README.md).
Auth redirect allow-lists and other provider configuration belong in the main
README, not in a migration.
