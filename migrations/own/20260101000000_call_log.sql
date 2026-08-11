-- Migration: the call log
-- Target:    this plane's own store
-- Applies as: the database owner
-- Applied:   NOT YET APPLIED
-- Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS. Never drops data.
-- Rollback:  DROP TABLE call_log;
--            (Safe. The log is observability, not state — lib/store.ts no-ops
--            when the store is unreachable and everything else keeps working.)
-- Verify:    SELECT count(*) FROM call_log;   -- expect a number, not an error

CREATE TABLE IF NOT EXISTS call_log (
  id            bigserial PRIMARY KEY,
  -- WHO issued the call. Not optional in spirit: a log that answers "was this
  -- read?" but not "by whom?" fails the question that actually gets asked, and
  -- the one an accountability obligation expects an answer to.
  actor         text,
  source_id     text,
  method        text NOT NULL,
  path          text NOT NULL,
  status        integer,
  response_body text,
  duration_ms   integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_log_recent ON call_log (id DESC);
-- Supports the retention sweep in lib/store.ts.
CREATE INDEX IF NOT EXISTS idx_call_log_created_at ON call_log (created_at);

COMMENT ON TABLE call_log IS
  'Every vendor call this plane has issued. No secrets — the plane holds no '
  'token of its own. But response_body IS production personal data copied out '
  'of the observed system, so retention is bounded; see lib/store.ts.';
