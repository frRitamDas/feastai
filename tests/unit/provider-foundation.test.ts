import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  decryptCredential,
  encryptCredential,
} from "../../lib/server/credential-crypto";
import {
  discoverModels,
  normalizeModels,
  parseRetryAfter,
} from "../../lib/server/providers/discovery";

test("credentials are encrypted, randomized and bound to their row", () => {
  const key = randomBytes(32).toString("base64");
  const first = encryptCredential("example-secret", "key-1", key);
  const second = encryptCredential("example-secret", "key-1", key);
  assert.notEqual(first.iv, second.iv);
  assert.ok(!JSON.stringify(first).includes("example-secret"));
  assert.equal(decryptCredential(first, "key-1", key), "example-secret");
  assert.throws(() => decryptCredential(first, "key-2", key));
  assert.throws(() =>
    decryptCredential(
      { ...first, tag: Buffer.alloc(16).toString("base64") },
      "key-1",
      key
    )
  );
  assert.throws(() => encryptCredential("secret", "key-1", undefined));
  assert.throws(() => encryptCredential("secret", "key-1", "wrong"));
});

test("model discovery normalizes and deduplicates without inventing metadata", () => {
  assert.deepEqual(
    normalizeModels({
      data: [{ id: "a", name: "A" }, { id: "a" }, { id: "b" }, {}],
    }),
    [
      { id: "a", name: "A" },
      { id: "b", name: "b" },
    ]
  );
  assert.equal(normalizeModels({ models: [] }), null);
});

test("discovery uses fixed URL and safely maps responses", async () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const mock: typeof fetch = (input, init) => {
    calls.push({
      auth: new Headers(init?.headers).get("authorization"),
      url: String(input),
    });
    return Promise.resolve(Response.json({ data: [{ id: "test-model" }] }));
  };
  assert.deepEqual(await discoverModels("groq", "example-key", mock), {
    models: [{ id: "test-model", name: "test-model" }],
    status: "discovered",
  });
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/models");
  assert.equal(calls[0].auth, "Bearer example-key");
  assert.deepEqual(
    await discoverModels("groq", "x", () =>
      Promise.resolve(new Response("private error", { status: 401 }))
    ),
    { status: "authentication_failed" }
  );
  assert.deepEqual(
    await discoverModels(
      "groq",
      "x",
      async () =>
        new Response(null, { headers: { "Retry-After": "120" }, status: 429 })
    ),
    { retryAfterSeconds: 120, status: "rate_limited" }
  );
  assert.deepEqual(
    await discoverModels("groq", "x", () =>
      Promise.reject(new Error("example secret"))
    ),
    { status: "unavailable" }
  );
  assert.deepEqual(await discoverModels("groq", "x\r\ny", mock), {
    status: "invalid_response",
  });
});

test("retry-after is bounded and handles dates", () => {
  assert.equal(parseRetryAfter("999999"), 86_400);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:01:00 GMT", 0), 60);
  assert.equal(parseRetryAfter("not valid"), undefined);
});
