import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";
import {
  customProviderFetch,
  isPublicAddress,
  parseCustomCredential,
  publicLookup,
} from "../../lib/server/providers/custom";
import { discoverModels } from "../../lib/server/providers/discovery";
import { createProviderModel } from "../../lib/server/providers/inference";

const host = "api.example.com";
const credential = JSON.stringify({
  apiKey: "secret-example",
  baseUrl: `https://${host}/v1`,
});

test("custom providers require an exact HTTPS allowlisted hostname", () => {
  assert.deepEqual(parseCustomCredential(credential, host), {
    apiKey: "secret-example",
    baseUrl: `https://${host}/v1`,
  });
  for (const baseUrl of [
    "http://api.example.com/v1",
    "https://127.0.0.1/v1",
    "https://api.example.com.evil.test/v1",
    "https://api.example.com:8443/v1",
    "https://user@api.example.com/v1",
    "https://api.example.com/v1?x=1",
    "https://api.example.com/v1/%2e%2e/x",
  ]) {
    assert.throws(() =>
      parseCustomCredential(JSON.stringify({ apiKey: "secret", baseUrl }), host)
    );
  }
  assert.throws(() => parseCustomCredential(credential, ""));
});

test("custom DNS protection rejects private, mapped and non-global addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "::a00:1",
    "64:ff9b::a00:1",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  await new Promise<void>((resolve, reject) => {
    publicLookup("localhost", { all: false, family: 0 }, (error) =>
      error ? resolve() : reject(new Error("Localhost must be rejected"))
    );
  });
});

test("custom requests stay on the allowed origin and preserve validated transport", async () => {
  const request: typeof fetch = (input, init) => {
    assert.ok(String(input).startsWith(`https://${host}/v1/`));
    assert.equal(init?.redirect, "error");
    assert.ok("dispatcher" in (init ?? {}));
    return Promise.resolve(Response.json({ data: [{ id: "custom-model" }] }));
  };
  const guarded = customProviderFetch(`https://${host}/v1`, request);
  assert.throws(() => guarded("https://other.example.com/v1/models"));
  assert.throws(() => guarded(`https://${host}/other/models`));
  const old = process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
  process.env.GRACE_CUSTOM_PROVIDER_HOSTS = host;
  try {
    assert.deepEqual(await discoverModels("custom", credential, request), {
      models: [{ id: "custom-model", name: "custom-model" }],
      status: "discovered",
    });
  } finally {
    if (old === undefined) {
      delete process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
    } else {
      process.env.GRACE_CUSTOM_PROVIDER_HOSTS = old;
    }
  }
});

test("custom model streams through the approved base URL", async () => {
  const old = process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
  process.env.GRACE_CUSTOM_PROVIDER_HOSTS = host;
  try {
    const request: typeof fetch = (input, init) => {
      assert.equal(String(input), `https://${host}/v1/chat/completions`);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer secret-example"
      );
      assert.equal(init?.redirect, "error");
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "OK", role: "assistant" }, finish_reason: null, index: 0 }], id: "1" })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }], id: "1" })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } }
        )
      );
    };
    const result = streamText({
      maxRetries: 0,
      model: createProviderModel("custom", "custom-model", credential, request),
      prompt: "hello",
    });
    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
    }
    assert.equal(text, "OK");
  } finally {
    if (old === undefined) {
      delete process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
    } else {
      process.env.GRACE_CUSTOM_PROVIDER_HOSTS = old;
    }
  }
});
