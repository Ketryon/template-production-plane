import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Conventions in ../README.md, enforced.
 *
 * A migration folder with rules nobody checks is a folder with rules nobody
 * follows — and the failure is silent, because a badly named or headerless
 * migration still runs perfectly well when pasted by hand. These tests are the
 * only thing standing between the conventions and entropy.
 *
 * The directory check (rule 6) is not hypothetical. the observed system's repo keeps 37
 * foundational migrations, including its init.sql, in a `supabase/migrations 2/`
 * directory the Supabase CLI has never read, so that repo cannot rebuild its own
 * database from source. It got there through a Finder folder copy and a squashed
 * release-train merge, and nothing failed.
 */

const MIGRATIONS = fileURLToPath(new URL("..", import.meta.url));

/** The only directories allowed under migrations/ — one per target database. */
const TARGETS = ["observed", "own"] as const;

const FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

const REQUIRED_HEADERS = [
  "-- Migration:",
  "-- Target:",
  "-- Applies as:",
  "-- Applied:",
  "-- Idempotent:",
  "-- Rollback:",
  "-- Verify:",
] as const;

function sqlFiles(target: string): string[] {
  return readdirSync(path.join(MIGRATIONS, target))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

const everyMigration = TARGETS.flatMap((target) =>
  sqlFiles(target).map((file) => ({
    target,
    file,
    rel: `${target}/${file}`,
    body: readFileSync(path.join(MIGRATIONS, target, file), "utf8"),
  })),
);

describe("layout", () => {
  it("has exactly one directory per target and nothing else", () => {
    const dirs = readdirSync(MIGRATIONS)
      .filter((name) => statSync(path.join(MIGRATIONS, name)).isDirectory())
      .filter((name) => name !== "__tests__")
      .sort();

    // A stray `observed 2/` lands here, which is the whole point.
    expect(dirs).toEqual([...TARGETS]);
  });

  it("holds at least one migration per target", () => {
    for (const target of TARGETS) {
      expect(sqlFiles(target).length, `${target}/ is empty`).toBeGreaterThan(0);
    }
  });
});

describe("filenames", () => {
  it.each(everyMigration)(
    "$rel is YYYYMMDDHHMMSS_snake_case.sql",
    ({ file }) => {
      expect(file).toMatch(FILENAME);
    },
  );

  it("has no duplicate timestamps within a target", () => {
    for (const target of TARGETS) {
      const stamps = sqlFiles(target).map((f) => f.slice(0, 14));
      expect(new Set(stamps).size, `${target}/ has a duplicate timestamp`).toBe(
        stamps.length,
      );
    }
  });

  it("uses timestamps that parse as real UTC datetimes", () => {
    for (const { rel, file } of everyMigration) {
      const s = file.slice(0, 14);
      const iso =
        `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T` +
        `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
      expect(Number.isNaN(Date.parse(iso)), `${rel} has an impossible timestamp`)
        .toBe(false);
    }
  });
});

describe("headers", () => {
  it.each(everyMigration)("$rel carries the full header block", ({ body }) => {
    for (const field of REQUIRED_HEADERS) {
      expect(body).toContain(field);
    }
  });

  it.each(everyMigration)(
    "$rel states a rollback rather than leaving it blank",
    ({ body }) => {
      const line = body.match(/^-- Rollback:(.*)$/m)?.[1] ?? "";
      // "restore from backup" is a legitimate answer. Silence is not.
      expect(line.trim().length).toBeGreaterThan(3);
    },
  );

  it.each(everyMigration)(
    "$rel records an application date or says it has not been applied",
    ({ body }) => {
      const line = body.match(/^-- Applied:(.*)$/m)?.[1]?.trim() ?? "";
      expect(
        line === "NOT YET APPLIED" || /^\d{4}-\d{2}-\d{2}/.test(line),
        `Applied: must be a YYYY-MM-DD date or exactly "NOT YET APPLIED", got "${line}"`,
      ).toBe(true);
    },
  );
});

describe("the ledger agrees with the headers", () => {
  const ledger = readFileSync(path.join(MIGRATIONS, "_applied.md"), "utf8");

  it.each(everyMigration)("$rel appears in _applied.md", ({ file }) => {
    expect(ledger).toContain(file);
  });

  it.each(everyMigration)(
    "$rel has the same applied state in both places",
    ({ file, body }) => {
      const header = body.match(/^-- Applied:(.*)$/m)?.[1]?.trim() ?? "";
      const row = ledger
        .split("\n")
        .find((line) => line.includes(`\`${file}\``));
      expect(row, `${file} has no row in _applied.md`).toBeDefined();

      // The ledger writes an unapplied migration as "—". Drifting between the
      // two is exactly how a ledger stops being worth reading.
      const ledgerSaysApplied = !/\|\s*—\s*\|/.test(row!);
      const headerSaysApplied = header !== "NOT YET APPLIED";
      expect(
        ledgerSaysApplied,
        `${file}: header says ${headerSaysApplied ? "applied" : "not applied"}, ledger disagrees`,
      ).toBe(headerSaysApplied);
    },
  );
});

describe("idempotency", () => {
  /**
   * Rule 2: every file must be safe to paste twice, because nothing tracks what
   * has already run.
   *
   * This cannot be proven by reading text. An earlier version of this test
   * sniffed for "IF NOT EXISTS" / "OR REPLACE" and would have failed the role
   * migration, which is pure GRANT and ALTER ROLE — idempotent by construction
   * and containing neither string. Sniffing punishes the safest file in the
   * folder while passing anything that merely contains the magic words.
   *
   * So the author states the reason instead, the same way they state the
   * rollback, and the reviewer judges it.
   */
  it.each(everyMigration)(
    "$rel says why it is safe to run twice",
    ({ body }) => {
      const line = body.match(/^-- Idempotent:(.*)$/m)?.[1] ?? "";
      expect(line.trim().length).toBeGreaterThan(3);
    },
  );

  it.each(everyMigration)(
    "$rel re-applies REVOKE after any CREATE OR REPLACE FUNCTION",
    ({ body }) => {
      // Postgres re-grants EXECUTE to PUBLIC on every CREATE OR REPLACE
      // FUNCTION. Forgetting the REVOKE makes a SECURITY DEFINER function
      // callable by anyone the moment it is edited — including, on a Supabase
      // project, `anon` if the function is in an exposed schema.
      if (!/CREATE OR REPLACE FUNCTION/i.test(body)) return;
      expect(body).toMatch(/REVOKE ALL ON FUNCTION/i);
    },
  );
});

describe("migrations against the observed system do not overstep", () => {
  /**
   * We are a guest in the observed system's database. The lab may be granted reads; it may
   * not reshape the schema it is reading. Anything below is a sign that a
   * migration wandered from "give the lab a view of production" into "change
   * production", which is the one thing this whole repo exists not to do.
   */
  const FORBIDDEN = [
    /\bDROP\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bUPDATE\s+\w+\s+SET\b/i,
    /\bINSERT\s+INTO\b/i,
  ];

  const observedMigrations = everyMigration.filter((m) => m.target === "observed");

  it.each(observedMigrations)("$rel changes no the observed system data or tables", ({ body }) => {
    // Strip comments first — the headers legitimately mention UPDATE and DROP
    // when describing verification and rollback.
    const sql = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    for (const pattern of FORBIDDEN) {
      expect(pattern.test(sql), `${pattern} appears in executable SQL`).toBe(false);
    }
  });
});
