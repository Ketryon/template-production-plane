-- Migration: what the plane's read-only role may see
-- Target:    the observed system's production database
-- Applies as: a superuser or owner, by hand
-- Applied:   NOT YET APPLIED
-- Idempotent: GRANT is idempotent by construction — re-granting a privilege the
--            role already holds is a no-op. There is no CREATE here.
-- Rollback:  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM plane_readonly;
--            REVOKE USAGE ON SCHEMA public FROM plane_readonly;
-- Verify:    SET ROLE plane_readonly;
--            UPDATE public.<a_table> SET <col> = <val> WHERE false;
--            -- want: ERROR: permission denied
--
-- TEMPLATE — replace the table list, then delete this paragraph.
--
-- The role itself is created out of band. `CREATE ROLE ... PASSWORD` would put a
-- credential in git (../README.md rule 2b), so only the GRANTS live here — which
-- is the part with a blast radius and the part worth reviewing in a diff.
--
--   CREATE ROLE plane_readonly WITH LOGIN PASSWORD '<generate one>';

GRANT USAGE ON SCHEMA public TO plane_readonly;

-- Declared in full rather than incrementally: this block is the whole truth
-- about what the plane can see. Adding a table is a deliberate act — it widens
-- what a leaked connection string exposes.
--
-- Note the absence of ALTER DEFAULT PRIVILEGES. A table added next year must NOT
-- become readable automatically; every addition goes through a migration so the
-- blast radius stays something someone chose.
GRANT SELECT ON
  public.<table_one>,
  public.<table_two>
TO plane_readonly;

-- If the tables above have row-level security with no policy matching this role,
-- it will connect fine and silently return ZERO ROWS — which reads as "nothing
-- to reconcile" rather than "no access", the worst possible failure for a tool
-- whose job is spotting discrepancies. If that applies, decide deliberately:
--
--   ALTER ROLE plane_readonly BYPASSRLS;
--
-- and record why. It only widens reads, but it also removes the row filter that
-- would otherwise scope them.
