// biome-ignore-all lint/performance/noAwaitInLoops: Schema migrations apply sequentially.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { genSaltSync, hashSync } from "bcrypt-ts";
import { encryptCredential } from "../../lib/server/credential-crypto";
import { exerciseBrowser } from "./browser-ui";

async function main() {
  assert.ok(
    process.env.GRACE_BROWSER_EXECUTABLE,
    "Set GRACE_BROWSER_EXECUTABLE to a local Chromium binary"
  );
  const db = new PGlite();
  for (const migration of [
    "0000_initial",
    "0001_grace_provider_catalog",
    "0002_grace_private_app_tables",
    "0003_grace_rate_limits",
    "0004_grace_gemini_provider",
    "0005_grace_administration",
    "0006_grace_routing_priority",
    "0007_grace_huggingface_provider",
    "0008_grace_usage_events",
    "0009_grace_cloudflare_provider",
    "0010_grace_routing_groups",
    "0011_grace_custom_provider",
    "0012_grace_verification_health",
    "0013_grace_account_policies",
    "0014_grace_announcements",
    "0015_grace_session_version",
    "0016_grace_private_attachments",
    "0017_grace_usage_attribution",
    "0018_grace_system_settings",
    "0019_grace_attachment_retention",
    "0020_grace_runtime_routing",
    "0021_grace_model_entitlements",
  ]) {
    await db.exec(await readFile(`lib/db/migrations/${migration}.sql`, "utf8"));
  }
  const encryptionKey = Buffer.alloc(32, 42).toString("base64");
  const totpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const [owner] = (
    await db.query<{ id: string }>(
      'INSERT INTO "User" ("email", "password") VALUES ($1, $2) RETURNING "id"',
      ["person@example.com", hashSync("correct-password", genSaltSync(10))]
    )
  ).rows;
  await db.query(
    'INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret") VALUES ($1, \'owner\', $2::text::jsonb)',
    [
      owner.id,
      JSON.stringify(
        encryptCredential(totpSecret, `admin:${owner.id}`, encryptionKey)
      ),
    ]
  );
  const socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    maxConnections: 10,
    port: 55_440,
  });
  await socket.start();
  const certDir = await mkdtemp(join(tmpdir(), "grace-browser-"));
  const key = join(certDir, "key.pem");
  const cert = join(certDir, "cert.pem");
  const openssl = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  );
  assert.equal(
    openssl.status,
    0,
    "openssl is required for the HTTPS test proxy"
  );
  const base = "https://localhost:35441";
  const proxy = https.createServer(
    { cert: await readFile(cert), key: await readFile(key) },
    (req, res) => {
      const upstream = http.request(
        {
          headers: {
            ...req.headers,
            host: "localhost:35441",
            "x-forwarded-host": "localhost:35441",
            "x-forwarded-proto": "https",
          },
          hostname: "127.0.0.1",
          method: req.method,
          path: req.url,
          port: 35_440,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        }
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    }
  );
  await new Promise<void>((resolveListen) =>
    proxy.listen(35_441, "127.0.0.1", resolveListen)
  );
  const child = spawn(
    "./node_modules/.bin/next",
    ["start", "-p", "35440", "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        AUTH_SECRET: "integration-only-auth-secret-32-characters-long",
        AUTH_URL: base,
        GRACE_CATALOG_ENABLED: "1",
        GRACE_ENCRYPTION_KEY: encryptionKey,
        GRACE_INTEGRATION_MOCK_TURNSTILE: "1",
        GRACE_TURNSTILE_SECRET: "integration-only-turnstile-secret",
        NODE_ENV: "production",
        NODE_OPTIONS: `--require ${resolve("tests/integration/mock-provider.cjs")}`,
        POSTGRES_URL:
          "postgres://postgres:postgres@127.0.0.1:55440/postgres?sslmode=disable",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  try {
    let ready = false;
    for (let i = 0; i < 30; i += 1) {
      try {
        ready = (await fetch("http://127.0.0.1:35440/api/auth/csrf")).ok;
        if (ready) {
          break;
        }
      } catch {
        /* startup */
      }
      if (child.exitCode !== null) {
        throw new Error(`Server exited: ${logs}`);
      }
      await delay(1000);
    }
    assert.ok(ready, `Server did not start: ${logs}`);
    try {
      await exerciseBrowser(base, totpSecret);
    } catch (error) {
      const counters = await db.query(
        `SELECT split_part("key", ':', 1) AS scope, count(*)::int AS rows FROM "GraceRateLimit" GROUP BY 1`
      );
      console.error("Isolated rate-limit scopes:", counters.rows);
      console.error(`Isolated browser server log:\n${logs}`);
      throw error;
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolveClose) =>
      proxy.close(() => resolveClose())
    );
    await socket.stop();
    await db.close();
    await rm(certDir, { force: true, recursive: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
