import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import {
  resolveDatabaseUrl,
  supabasePoolerOptions,
} from "../../lib/db/connection-url";
import { SUPABASE_ROOT_CA_2021 } from "../../lib/db/supabase-ca";

const direct =
  "postgresql://postgres:example%40secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?application_name=grace";
const pooler = "aws-0-eu-west-1.pooler.supabase.com";

test("bundled Supabase public root has the expected fingerprint", () => {
  const root = new X509Certificate(SUPABASE_ROOT_CA_2021);
  assert.equal(
    root.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
  );
  assert.equal(root.ca, true);
  assert.match(root.subject, /CN=Supabase Root 2021 CA/);
});

test("keeps direct and local URLs unchanged when no pooler is configured", () => {
  assert.equal(resolveDatabaseUrl(direct), direct);
  assert.equal(
    resolveDatabaseUrl("postgres://localhost/test"),
    "postgres://localhost/test"
  );
});

test("builds a Supabase transaction-pooler URL without altering credentials", () => {
  const result = new URL(resolveDatabaseUrl(direct, pooler));
  assert.equal(result.hostname, pooler);
  assert.equal(result.port, "6543");
  assert.equal(result.username, "postgres.abcdefghijklmnopqrst");
  assert.equal(result.password, "example%40secret");
  assert.equal(result.searchParams.get("application_name"), "grace");
  assert.equal(result.searchParams.get("sslmode"), "verify-full");
  assert.equal(
    resolveDatabaseUrl(result.toString(), pooler),
    result.toString()
  );
});

test("pooler options pin the CA and disable unsafe transaction features", async () => {
  const url = resolveDatabaseUrl(direct, pooler);
  const options = supabasePoolerOptions(url);
  const client = postgres(`${url}&sslmode=require`, options);
  assert.equal(client.options.prepare, false);
  assert.equal(Reflect.get(client.options, "max_pipeline"), 1);
  assert.deepEqual(client.options.ssl, {
    ca: SUPABASE_ROOT_CA_2021,
    rejectUnauthorized: true,
  });
  await client.end();

  const sessionUrl = url.replace(":6543/", ":5432/");
  const sessionOptions = supabasePoolerOptions(sessionUrl);
  assert.equal(sessionOptions.prepare, undefined);
  assert.equal(sessionOptions.ssl?.rejectUnauthorized, true);
  assert.deepEqual(supabasePoolerOptions("postgres://localhost/db"), {});
  assert.deepEqual(
    supabasePoolerOptions(`postgres://${pooler}.attacker.example/db`),
    {}
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
