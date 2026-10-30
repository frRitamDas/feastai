import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";
import { createFallbackModel } from "../../lib/server/providers/fallback";

const candidates = [
  { credential: "first", provider: "groq" as const, upstreamId: "same-model" },
  { credential: "second", provider: "groq" as const, upstreamId: "same-model" },
];
function eventStream() {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "OK", role: "assistant" }, finish_reason: null, index: 0 }], id: "1" })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }], id: "1" })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } }
  );
}
test("transient failure before streaming falls back to another permitted key", async () => {
  const auth: string[] = [];
  const request: typeof fetch = (_url, options) => {
    const header = new Headers(options?.headers).get("authorization") ?? "";
    auth.push(header);
    return Promise.resolve(
      header === "Bearer first"
        ? new Response(JSON.stringify({ error: { message: "overloaded" } }), {
            headers: { "content-type": "application/json" },
            status: 503,
          })
        : eventStream()
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createFallbackModel(candidates, request),
    prompt: "Hello",
  });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
  assert.deepEqual(auth, ["Bearer first", "Bearer second"]);
});
test("credential errors do not fall back", async () => {
  let calls = 0;
  const request: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        headers: { "content-type": "application/json" },
        status: 401,
      })
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createFallbackModel(candidates, request),
    onError: () => undefined,
    prompt: "Hello",
  });
  let errorSeen = false;
  for await (const chunk of result.fullStream) {
    if (chunk.type === "error") {
      errorSeen = true;
    }
  }
  assert.equal(errorSeen, true);
  assert.equal(calls, 1);
});

test("errors after a stream is opened never trigger another key", async () => {
  let calls = 0;
  let phase = 0;
  const request: typeof fetch = () => {
    calls += 1;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (phase === 0) {
          phase += 1;
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "partial", role: "assistant" }, finish_reason: null, index: 0 }], id: "1" })}\n\n`
            )
          );
        } else {
          controller.error(new Error("stream interrupted"));
        }
      },
    });
    return Promise.resolve(
      new Response(body, { headers: { "content-type": "text/event-stream" } })
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createFallbackModel(candidates, request),
    onError: () => undefined,
    prompt: "Hello",
  });
  await assert.rejects(async () => {
    for await (const _part of result.fullStream) {
      /* consume */
    }
  });
  assert.equal(calls, 1);
});

test("automatic routes switch to an explicitly configured different provider before streaming", async () => {
  const used: string[] = [];
  const request: typeof fetch = (url, options) => {
    used.push(`${String(url)}:${JSON.parse(String(options?.body)).model}`);
    if (used.length === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "busy" } }), {
          headers: { "content-type": "application/json" },
          status: 503,
        })
      );
    }
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer google"
    );
    return Promise.resolve(eventStream());
  };
  const route = createFallbackModel(
    [
      { credential: "groq", provider: "groq", upstreamId: "model-a" },
      { credential: "google", provider: "gemini", upstreamId: "model-b" },
    ],
    request
  );
  const result = streamText({ maxRetries: 0, model: route, prompt: "Hello" });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
  assert.equal(used.length, 2);
  assert.ok(used[0].endsWith(":model-a"));
  assert.ok(used[1].endsWith(":model-b"));
});
