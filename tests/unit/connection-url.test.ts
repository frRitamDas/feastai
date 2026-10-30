import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseUrl } from "../../lib/db/connection-url";

const direct =
  "postgresql://postgres:example%40secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?application_name=grace";
const pooler = "aws-0-eu-west-1.pooler.supabase.com";

test("keeps direct and local URLs unchanged when no pooler is configured", () => {
  assert.equal(resolveDatabaseUrl(direct), direct);
  assert.equal(
    resolveDatabaseUrl("postgres://localhost/test"),
    "postgres://localhost/test"
  );
});

test("builds a Supabase session-pooler URL without altering credentials", () => {
  const result = new URL(resolveDatabaseUrl(direct, pooler));
  assert.equal(result.hostname, pooler);
  assert.equal(result.port, "5432");
  assert.equal(result.username, "postgres.abcdefghijklmnopqrst");
  assert.equal(result.password, "example%40secret");
  assert.equal(result.searchParams.get("application_name"), "grace");
  assert.equal(result.searchParams.get("sslmode"), "require");
  assert.equal(
    resolveDatabaseUrl(result.toString(), pooler),
    result.toString()
  );
});

test("does not send credentials to untrusted hosts or rewrite unrelated databases", () => {
  assert.throws(() => resolveDatabaseUrl(direct, "pooler.evil.example"));
  assert.throws(() =>
    resolveDatabaseUrl("postgres://alice:secret@example.com/db", pooler)
  );
  assert.throws(() =>
    resolveDatabaseUrl("https://db.abcdefghijklmnopqrst.supabase.co", pooler)
  );
  assert.throws(() =>
    resolveDatabaseUrl(
      "postgres://db.abcdefghijklmnopqrst.supabase.co/test",
      pooler
    )
  );
});
