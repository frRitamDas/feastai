// biome-ignore-all lint/performance/noAwaitInLoops: Migrations and startup checks are sequential.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { genSaltSync, hashSync } from "bcrypt-ts";
import { totpCode } from "../../lib/server/admin/totp";

async function main() {
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
  const bootstrapSecret =
    "integration-only-bootstrap-secret-at-least-32-characters";
  const hash = hashSync("correct-password", genSaltSync(10));
  await db.query(
    'INSERT INTO "User" ("email", "password") VALUES ($1, $2), ($3, $2)',
    ["person@example.com", hash, "other@example.com"]
  );
  const socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    maxConnections: 10,
    port: 55_439,
  });
  await socket.start();
  const base = "http://localhost:35439";
  const child = spawn(
    "./node_modules/.bin/next",
    ["dev", "-p", "35439", "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        AUTH_SECRET: "integration-only-auth-secret-32-characters-long",
        AUTH_URL: base,
        GRACE_BOOTSTRAP_SECRET: bootstrapSecret,
        GRACE_CATALOG_ENABLED: "1",
        GRACE_ENCRYPTION_KEY: encryptionKey,
        NODE_ENV: "development",
        NODE_OPTIONS: `--require ${resolve("tests/integration/mock-provider.cjs")}`,
        POSTGRES_URL:
          "postgres://postgres:postgres@127.0.0.1:55439/postgres?sslmode=disable",
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
    let csrfResponse: Response | undefined;
    for (let i = 0; i < 90; i += 1) {
      try {
        csrfResponse = await fetch(`${base}/api/auth/csrf`);
        if (csrfResponse.ok) {
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
    assert.ok(csrfResponse?.ok, `Server did not start: ${logs}`);
    for (const path of ["/login", "/register"]) {
      // These must be reachable without first provisioning a guest session.
      const response = await fetch(`${base}${path}`, { redirect: "manual" });
      assert.equal(response.status, 200, `${path}: ${logs}`);
    }
    const beforeGuest = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "User" WHERE "isAnonymous" = true'
    );
    assert.equal(beforeGuest.rows[0].count, 0);
    const guestResponse = await fetch(
      `${base}/api/auth/guest?redirectUrl=%2F`,
      {
        redirect: "manual",
      }
    );
    assert.equal(guestResponse.status, 307, `Guest sign-in: ${logs}`);
    assert.ok(
      guestResponse.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("authjs.session-token=")),
      `Guest sign-in did not issue a session: ${logs}`
    );
    const guestUsers = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "User" WHERE "isAnonymous" = true'
    );
    assert.equal(guestUsers.rows[0].count, 1);
    const csrf = await csrfResponse.json();
    const initialCookies = csrfResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const login = await fetch(`${base}/api/auth/callback/credentials`, {
      body: new URLSearchParams({
        callbackUrl: base,
        csrfToken: csrf.csrfToken,
        email: "person@example.com",
        password: "correct-password",
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: initialCookies,
        Origin: base,
      },
      method: "POST",
      redirect: "manual",
    });
    const sessionCookie = login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.startsWith("authjs.session-token="));
    assert.ok(
      sessionCookie,
      `Login did not issue a session: ${login.status} ${logs}`
    );
    const reqHeaders = { Cookie: sessionCookie, Origin: base };
    const profile = await fetch(`${base}/api/profile`, { headers: reqHeaders });
    assert.equal(profile.status, 200, await profile.text());
    const admin = await fetch(`${base}/api/administrator/overview`, {
      headers: reqHeaders,
    });
    assert.equal(admin.status, 401, logs);
    const [owner] = (
      await db.query<{ id: string }>(
        'SELECT "id" FROM "User" WHERE "email" = $1',
        ["person@example.com"]
      )
    ).rows;
    const bootstrap = (body: object) =>
      fetch(`${base}/api/administrator/bootstrap`, {
        body: JSON.stringify(body),
        headers: { ...reqHeaders, "Content-Type": "application/json" },
        method: "POST",
      });
    assert.equal(
      (
        await bootstrap({
          bootstrapSecret: "wrong",
          code: "000000",
          totpSecret,
        })
      ).status,
      403
    );
    // Generate the valid code after the first request has warmed the route, so
    // compiling under load cannot age a previous-step code out of the window.
    const bootstrapBody = {
      bootstrapSecret,
      code: totpCode(totpSecret, Math.floor(Date.now() / 30_000)),
      totpSecret,
    };
    assert.equal((await bootstrap(bootstrapBody)).status, 200);
    assert.equal((await bootstrap(bootstrapBody)).status, 409);
    const ownerRecord = await db.query(
      'SELECT "totpSecret" FROM "GraceAdministrator" WHERE "userId" = $1',
      [owner.id]
    );
    assert.equal(JSON.stringify(ownerRecord.rows).includes(totpSecret), false);
    const post = (action: string, body: object, cookie = sessionCookie) =>
      fetch(`${base}/api/administrator/${action}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: base,
        },
        method: "POST",
      });
    const beforeMfa = await post("create-announcement", {
      body: "World",
      title: "Hello",
    });
    assert.equal(beforeMfa.status, 403);
    // The next step is within the accepted clock-skew window and cannot reuse
    // the step consumed by enrollment.
    const code = totpCode(totpSecret, Math.floor(Date.now() / 30_000) + 1);
    const mfa = await post("mfa", { code });
    assert.equal(mfa.status, 200, `${await mfa.clone().text()} ${logs}`);
    const proof = mfa.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.startsWith("grace_admin_proof="));
    assert.ok(proof);
    const replay = await post("mfa", { code });
    assert.equal(replay.status, 401);
    const adminCookies = `${sessionCookie}; ${proof}`;
    const create = await post(
      "create-announcement",
      { body: "World", title: "Hello" },
      adminCookies
    );
    assert.equal(create.status, 200, `${await create.clone().text()} ${logs}`);
    const announcement = await create.json();
    const publish = await post(
      "set-announcement",
      { announcementId: announcement.id, enabled: true },
      adminCookies
    );
    assert.equal(publish.status, 200);
    const published = await fetch(`${base}/api/announcements`, {
      headers: reqHeaders,
    });
    assert.equal((await published.json()).announcements[0].title, "Hello");
    const addKey = await post(
      "add-key",
      { credential: "rate-limited-key", label: "mock", provider: "groq" },
      adminCookies
    );
    assert.equal(addKey.status, 200, `${await addKey.clone().text()} ${logs}`);
    const keyId = (await addKey.json()).id;
    const discovered = await post("discover", { keyId }, adminCookies);
    assert.equal(
      discovered.status,
      200,
      `${await discovered.clone().text()} ${logs}`
    );
    const overview = await fetch(`${base}/api/administrator/overview`, {
      headers: { Cookie: adminCookies },
    });
    assert.equal(
      overview.status,
      200,
      `${await overview.clone().text()} ${logs}`
    );
    const modelId = (await overview.json()).models[0].id;
    for (const [action, body] of [
      ["verify", { keyId, modelId }],
      ["key-enabled", { enabled: true, keyId }],
      ["key-priority", { keyId, priority: 0 }],
      ["model-enabled", { enabled: true, modelId }],
      ["permission", { enabled: true, keyId, modelId }],
    ] as const) {
      const response = await post(action, body, adminCookies);
      assert.equal(
        response.status,
        200,
        `${action}: ${await response.clone().text()} ${logs}`
      );
      if (action === "verify") {
        assert.equal((await response.json()).verified, true);
      }
    }
    const secondKeyResponse = await post(
      "add-key",
      {
        credential: "mock-provider-secret",
        label: "fallback",
        provider: "groq",
      },
      adminCookies
    );
    assert.equal(secondKeyResponse.status, 200);
    const secondKey = (await secondKeyResponse.json()).id;
    for (const [action, body] of [
      ["discover", { keyId: secondKey }],
      ["verify", { keyId: secondKey, modelId }],
      ["key-enabled", { enabled: true, keyId: secondKey }],
      ["permission", { enabled: true, keyId: secondKey, modelId }],
    ] as const) {
      const response = await post(action, body, adminCookies);
      assert.equal(
        response.status,
        200,
        `${action}: ${await response.clone().text()} ${logs}`
      );
      if (action === "verify") {
        assert.equal((await response.json()).verified, true);
      }
    }
    const pause = await post(
      "system-settings",
      { chatEnabled: false, registrationEnabled: false },
      adminCookies
    );
    assert.equal(pause.status, 200);
    const pausedChat = await fetch(`${base}/api/chat`, {
      body: JSON.stringify({
        id: randomUUID(),
        message: {
          id: randomUUID(),
          parts: [{ text: "Hello", type: "text" }],
          role: "user",
        },
        selectedChatModel: `grace/${modelId}`,
        selectedVisibilityType: "private",
      }),
      headers: { ...reqHeaders, "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(pausedChat.status, 503);
    const resume = await post(
      "system-settings",
      { chatEnabled: true, registrationEnabled: true },
      adminCookies
    );
    assert.equal(resume.status, 200);
    const textForm = new FormData();
    textForm.append(
      "file",
      new File(["Secret memo for Grace"], "note.txt", { type: "text/plain" })
    );
    const textUpload = await fetch(`${base}/api/files/upload`, {
      body: textForm,
      headers: reqHeaders,
      method: "POST",
    });
    assert.equal(textUpload.status, 200, await textUpload.clone().text());
    const textFile = await textUpload.json();
    const listed = await fetch(`${base}/api/models`, { headers: reqHeaders });
    assert.ok(
      (await listed.json()).eligibleModelIds.includes(`grace/${modelId}`)
    );
    const chatId = randomUUID();
    const chat = await fetch(`${base}/api/chat`, {
      body: JSON.stringify({
        id: chatId,
        message: {
          id: randomUUID(),
          parts: [
            { text: "Hello", type: "text" },
            {
              mediaType: "text/plain",
              name: "note.txt",
              type: "file",
              url: textFile.url,
            },
          ],
          role: "user",
        },
        selectedChatModel: `grace/${modelId}`,
        selectedVisibilityType: "private",
      }),
      headers: { ...reqHeaders, "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(chat.status, 200, `${await chat.clone().text()} ${logs}`);
    const streamed = await chat.text();
    assert.ok(
      streamed.includes("Hello from the mock model"),
      `${streamed} ${logs}`
    );
    const protectedFile = await fetch(textFile.url, {
      headers: reqHeaders,
      method: "DELETE",
    });
    assert.equal(protectedFile.status, 404);
    assert.equal(
      (await fetch(textFile.url, { headers: reqHeaders })).status,
      200
    );
    const messages = await db.query(
      'SELECT "role" FROM "Message_v2" WHERE "chatId" = $1 ORDER BY "createdAt"',
      [chatId]
    );
    assert.equal(messages.rows.length, 2);
    const usage = await db.query<{ provider: string; upstreamModel: string }>(
      'SELECT "provider", "upstreamModel" FROM "GraceUsageEvent" WHERE "chatId" = $1',
      [chatId]
    );
    assert.equal(usage.rows[0]?.provider, "groq");
    assert.equal(usage.rows[0]?.upstreamModel, "integration-model");
    const form = new FormData();
    form.append(
      "file",
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "test.png",
        { type: "image/png" }
      )
    );
    const upload = await fetch(`${base}/api/files/upload`, {
      body: form,
      headers: reqHeaders,
      method: "POST",
    });
    assert.equal(upload.status, 200, `${await upload.clone().text()} ${logs}`);
    const file = await upload.json();
    const imageChatId = randomUUID();
    const sendImage = () =>
      fetch(`${base}/api/chat`, {
        body: JSON.stringify({
          id: imageChatId,
          message: {
            id: randomUUID(),
            parts: [
              {
                mediaType: "image/png",
                name: "test.png",
                type: "file",
                url: file.url,
              },
            ],
            role: "user",
          },
          selectedChatModel: `grace/${modelId}`,
          selectedVisibilityType: "private",
        }),
        headers: { ...reqHeaders, "Content-Type": "application/json" },
        method: "POST",
      });
    const rejectedImage = await sendImage();
    assert.equal(rejectedImage.status, 400);
    assert.equal(
      (await db.query('SELECT "id" FROM "Chat" WHERE "id" = $1', [imageChatId]))
        .rows.length,
      0
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          'SELECT "count" FROM "GraceQuotaCounter" WHERE "userId" = $1',
          [owner.id]
        )
      ).rows[0].count,
      1
    );
    assert.equal(
      (await post("model-vision", { enabled: true, modelId }, adminCookies))
        .status,
      200
    );
    const visionModels = await fetch(`${base}/api/models`, {
      headers: reqHeaders,
    });
    assert.equal(
      (await visionModels.json()).capabilities[`grace/${modelId}`].vision,
      true
    );
    const imageChat = await sendImage();
    assert.equal(
      imageChat.status,
      200,
      `${await imageChat.clone().text()} ${logs}`
    );
    assert.ok((await imageChat.text()).includes("Hello from the mock model"));

    const assistantRows = await db.query<{ id: string; chatId: string }>(
      'SELECT "id", "chatId" FROM "Message_v2" WHERE "role" = \'assistant\' AND "chatId" IN ($1, $2)',
      [chatId, imageChatId]
    );
    const firstAssistant = assistantRows.rows.find(
      (row) => row.chatId === chatId
    );
    const secondAssistant = assistantRows.rows.find(
      (row) => row.chatId === imageChatId
    );
    assert.ok(firstAssistant && secondAssistant);
    const vote = (messageId: string, origin = base) =>
      fetch(`${base}/api/vote`, {
        body: JSON.stringify({ chatId, messageId, type: "up" }),
        headers: {
          ...reqHeaders,
          "Content-Type": "application/json",
          Origin: origin,
        },
        method: "PATCH",
      });
    assert.equal(
      (await vote(firstAssistant.id, "https://evil.example")).status,
      403
    );
    assert.equal((await vote(secondAssistant.id)).status, 404);
    assert.equal((await vote(firstAssistant.id)).status, 200);
    const documentId = randomUUID();
    const document = (origin: string) =>
      fetch(`${base}/api/document?id=${documentId}`, {
        body: JSON.stringify({
          content: "Safe note",
          kind: "text",
          title: "Note",
        }),
        headers: {
          ...reqHeaders,
          "Content-Type": "application/json",
          Origin: origin,
        },
        method: "POST",
      });
    assert.equal((await document("https://evil.example")).status, 403);
    assert.equal((await document(base)).status, 200);

    const health = await db.query<{
      lastRuntimeStatus: string;
      connectionsOpened: number;
      connectionFailures: number;
    }>(
      'SELECT "lastRuntimeStatus", "connectionsOpened", "connectionFailures" FROM "GraceKeyModel" WHERE "keyId" = $1 AND "modelId" = $2',
      [secondKey, modelId]
    );
    assert.equal(health.rows[0].lastRuntimeStatus, "opened");
    assert.equal(health.rows[0].connectionsOpened, 2);
    assert.equal(health.rows[0].connectionFailures, 0);
    const image = await fetch(file.url, { headers: reqHeaders });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    const other = await fetch(file.url, { redirect: "manual" });
    assert.notEqual(other.status, 200);
    const loginOther = await fetch(`${base}/api/auth/callback/credentials`, {
      body: new URLSearchParams({
        callbackUrl: base,
        csrfToken: csrf.csrfToken,
        email: "OTHER@example.com",
        password: "correct-password",
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: initialCookies,
        Origin: base,
      },
      method: "POST",
      redirect: "manual",
    });
    const otherCookie = loginOther.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.startsWith("authjs.session-token="));
    assert.ok(otherCookie);
    assert.equal(
      (await fetch(file.url, { headers: { Cookie: otherCookie } })).status,
      404
    );
    const [otherUser] = (
      await db.query<{ id: string }>(
        'SELECT "id" FROM "User" WHERE "email" = $1',
        ["other@example.com"]
      )
    ).rows;
    assert.equal(
      (await post("model-plan", { modelId, plan: "custom" }, adminCookies))
        .status,
      200
    );
    const otherModels = async () =>
      (
        await (
          await fetch(`${base}/api/models`, {
            headers: { Cookie: otherCookie },
          })
        ).json()
      ).eligibleModelIds as string[];
    assert.equal((await otherModels()).includes(`grace/${modelId}`), false);
    const deniedChat = await fetch(`${base}/api/chat`, {
      body: JSON.stringify({
        id: randomUUID(),
        message: {
          id: randomUUID(),
          parts: [{ text: "Hello", type: "text" }],
          role: "user",
        },
        selectedChatModel: `grace/${modelId}`,
        selectedVisibilityType: "private",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: otherCookie,
        Origin: base,
      },
      method: "POST",
    });
    assert.equal(deniedChat.status, 400);
    assert.equal(
      (
        await db.query(
          'SELECT "userId" FROM "GraceQuotaCounter" WHERE "userId" = $1',
          [otherUser.id]
        )
      ).rows.length,
      0
    );
    assert.equal(
      (
        await post(
          "set-user-policy",
          {
            enabled: true,
            hourlyQuota: 10,
            plan: "custom",
            planExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            userId: otherUser.id,
          },
          adminCookies
        )
      ).status,
      200
    );
    assert.equal((await otherModels()).includes(`grace/${modelId}`), true);
    assert.equal(
      (
        await post(
          "set-user-policy",
          {
            enabled: true,
            hourlyQuota: 10,
            plan: "custom",
            planExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
            userId: otherUser.id,
          },
          adminCookies
        )
      ).status,
      200
    );
    assert.equal((await otherModels()).includes(`grace/${modelId}`), false);
    assert.equal(
      (await post("model-plan", { modelId, plan: "free" }, adminCookies))
        .status,
      200
    );
    const disable = await post(
      "set-user-policy",
      { enabled: false, hourlyQuota: 10, plan: "free", userId: otherUser.id },
      adminCookies
    );
    assert.equal(
      disable.status,
      200,
      `${await disable.clone().text()} ${logs}`
    );
    assert.equal(
      (await fetch(`${base}/api/profile`, { headers: { Cookie: otherCookie } }))
        .status,
      401
    );
    const enable = await post(
      "set-user-policy",
      { enabled: true, hourlyQuota: 10, plan: "free", userId: otherUser.id },
      adminCookies
    );
    assert.equal(enable.status, 200);
    assert.equal(
      (await fetch(`${base}/api/profile`, { headers: { Cookie: otherCookie } }))
        .status,
      401
    );

    const unusedForm = new FormData();
    unusedForm.append(
      "file",
      new File(["Unused"], "unused.txt", { type: "text/plain" })
    );
    const unusedUpload = await fetch(`${base}/api/files/upload`, {
      body: unusedForm,
      headers: reqHeaders,
      method: "POST",
    });
    assert.equal(unusedUpload.status, 200);
    const unused = await unusedUpload.json();
    const clear = await fetch(`${base}/api/files`, {
      headers: reqHeaders,
      method: "DELETE",
    });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).removed, 1);
    assert.equal(
      (await fetch(unused.url, { headers: reqHeaders })).status,
      404
    );
    assert.equal((await fetch(file.url, { headers: reqHeaders })).status, 200);
    assert.equal(
      (await fetch(textFile.url, { headers: reqHeaders })).status,
      200
    );
    const change = await fetch(`${base}/api/profile`, {
      body: JSON.stringify({
        currentPassword: "correct-password",
        name: "Grace user",
        newPassword: "new-password-123",
      }),
      headers: { ...reqHeaders, "Content-Type": "application/json" },
      method: "PATCH",
    });
    assert.equal(change.status, 200, await change.clone().text());
    assert.equal((await change.json()).sessionRevoked, true);
    const revoked = await fetch(`${base}/api/profile`, { headers: reqHeaders });
    assert.equal(revoked.status, 401);
    console.log(
      "HTTP integration passed: admin MFA, catalog discovery/verification, mocked provider fallback/streaming with private text and image attachments, runtime health, expiring entitlements, usage, announcements, suspension and session revocation"
    );
  } finally {
    child.kill("SIGTERM");
    await socket.stop();
    await db.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
