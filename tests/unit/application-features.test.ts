import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  attachmentId,
  isSafeImage,
  isSafeText,
} from "../../lib/server/security/attachments";
import { verifyRegistrationChallenge } from "../../lib/server/security/turnstile";

test("registration challenge requires successful host- and action-bound verification", async () => {
  const options = {
    expectedHost: "https://grace.example",
    production: true,
    secret: "secret",
    token: "test-token",
  };
  let calls = 0;
  const request: typeof fetch = (url, init) => {
    calls += 1;
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    assert.equal(init?.redirect, "error");
    return Promise.resolve(
      Response.json({
        action: "register",
        hostname: "grace.example",
        success: true,
      })
    );
  };
  assert.equal(
    await verifyRegistrationChallenge({ ...options, request }),
    true
  );
  assert.equal(calls, 1);
  assert.equal(
    await verifyRegistrationChallenge({ ...options, secret: undefined }),
    false
  );
  assert.equal(
    await verifyRegistrationChallenge({ ...options, request, token: null }),
    false
  );
  assert.equal(
    await verifyRegistrationChallenge({
      ...options,
      request: () =>
        Promise.resolve(
          Response.json({
            action: "register",
            hostname: "evil.example",
            success: true,
          })
        ),
    }),
    false
  );
  assert.equal(
    await verifyRegistrationChallenge({
      ...options,
      request: () =>
        Promise.resolve(
          Response.json({
            action: "login",
            hostname: "grace.example",
            success: true,
          })
        ),
    }),
    false
  );
  assert.equal(
    await verifyRegistrationChallenge({
      ...options,
      request: () => Promise.reject(new Error("offline")),
    }),
    false
  );
});

test("attachment validation rejects untrusted locations and mismatched image signatures", () => {
  const url =
    "https://grace.example/api/files/12345678-1234-4123-8123-123456789abc";
  assert.equal(
    attachmentId(url, "https://grace.example/api/chat"),
    "12345678-1234-4123-8123-123456789abc"
  );
  assert.equal(attachmentId(url, "https://other.example/api/chat"), null);
  assert.equal(attachmentId(`${url}?x=1`, "https://grace.example"), null);
  assert.equal(
    attachmentId(
      "https://grace.example/api/files/../../admin",
      "https://grace.example"
    ),
    null
  );
  assert.equal(
    isSafeImage(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png"
    ),
    true
  );
  assert.equal(
    isSafeImage(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/jpeg"
    ),
    false
  );
  assert.equal(isSafeImage(Buffer.from("not an image"), "image/png"), false);
  assert.equal(isSafeText(Buffer.from("Hello Grace"), "text/plain"), true);
  assert.equal(isSafeText(Buffer.from([0xff]), "text/plain"), false);
  assert.equal(isSafeText(Buffer.from([0x41, 0]), "text/plain"), false);
});

test("new application tables keep data private and preserve existing users", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("lib/db/migrations/0000_initial.sql", "utf8"));
    await db.exec(
      "INSERT INTO \"User\" (\"email\") VALUES ('regular@example.com'), ('guest-123456')"
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0013_grace_account_policies.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile("lib/db/migrations/0014_grace_announcements.sql", "utf8")
    );
    await db.exec(
      await readFile("lib/db/migrations/0015_grace_session_version.sql", "utf8")
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0016_grace_private_attachments.sql",
        "utf8"
      )
    );
    const users = await db.query<{
      email: string;
      isAnonymous: boolean;
      sessionVersion: number;
    }>(
      'SELECT "email", "isAnonymous", "sessionVersion" FROM "User" ORDER BY "email"'
    );
    assert.deepEqual(
      users.rows.map((user) => [
        user.email,
        user.isAnonymous,
        user.sessionVersion,
      ]),
      [
        ["guest-123456", true, 0],
        ["regular@example.com", false, 0],
      ]
    );
    await db.exec(
      'INSERT INTO "GraceAnnouncement" ("title", "body", "enabled") VALUES (\'hello\', \'world\', true)'
    );
    await db.exec(
      'INSERT INTO "GraceAttachment" ("userId", "name", "mediaType", "data") SELECT "id", \'a.png\', \'image/png\', decode(\'89504e470d0a1a0a\', \'hex\') FROM "User" WHERE "email" = \'regular@example.com\''
    );
    await db.exec(
      'CREATE ROLE feature_anon; GRANT SELECT ON "GraceAnnouncement", "GraceAttachment" TO feature_anon; SET ROLE feature_anon'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceAnnouncement"')).rows.length,
      0
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceAttachment"')).rows.length,
      0
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
