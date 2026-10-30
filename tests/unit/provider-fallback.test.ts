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
test("credential failures fall back to a different pre-authorized key", async () => {
  const observations: string[] = [];
  let calls = 0;
  const request: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? new Response(JSON.stringify({ error: { message: "bad key" } }), {
            headers: { "content-type": "application/json" },
            status: 401,
          })
        : eventStream()
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createFallbackModel(
      candidates,
      request,
      undefined,
      (observation) => {
        observations.push(observation.status);
        assert.equal(JSON.stringify(observation).includes("first"), false);
      }
    ),
    prompt: "Hello",
  });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
  assert.equal(calls, 2);
  assert.deepEqual(observations, ["authentication_failed", "opened"]);
});

test("invalid requests never fall back", async () => {
  let calls = 0;
  const request: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        headers: { "content-type": "application/json" },
        status: 400,
      })
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createFallbackModel(candidates, request),
    onError: () => undefined,
    prompt: "Hello",
  });
  for await (const _chunk of result.fullStream) {
    /* consume */
  }
  assert.equal(calls, 1);
});

test("network failures and per-attempt timeouts fall back before streaming", async () => {
  const observations: string[] = [];
  let calls = 0;
  const request: typeof fetch = (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(new TypeError("network unavailable"));
    }
    if (calls === 2) {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      });
    }
    return Promise.resolve(eventStream());
  };
  const model = createFallbackModel(
    [...candidates, { ...candidates[1], credential: "third" }],
    request,
    undefined,
    (observation) => {
      observations.push(observation.status);
    },
    25
  );
  const result = streamText({ maxRetries: 0, model, prompt: "Hello" });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
  assert.deepEqual(observations, ["unavailable", "timeout", "opened"]);
});

test("caller cancellation does not try another provider", async () => {
  let calls = 0;
  const abort = new AbortController();
  const request: typeof fetch = (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("cancelled")),
        { once: true }
      );
      abort.abort();
    });
  };
  const result = streamText({
    abortSignal: abort.signal,
    maxRetries: 0,
    model: createFallbackModel(candidates, request),
    onError: () => undefined,
    prompt: "Hello",
  });
  for await (const _chunk of result.fullStream) {
    /* consume */
  }
  assert.equal(calls, 1);
});

test("the connection timeout does not interrupt an established stream", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(async () => {
        controller.enqueue(new Uint8Array(await eventStream().arrayBuffer()));
        controller.close();
      }, 50);
    },
  });
  const request: typeof fetch = () =>
    Promise.resolve(
      new Response(body, { headers: { "content-type": "text/event-stream" } })
    );
  const model = createFallbackModel(
    candidates,
    request,
    undefined,
    undefined,
    10
  );
  const result = streamText({ maxRetries: 0, model, prompt: "Hello" });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
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
  let selected: { provider: string; upstreamId: string } | undefined;
  const route = createFallbackModel(
    [
      { credential: "groq", provider: "groq", upstreamId: "model-a" },
      { credential: "google", provider: "gemini", upstreamId: "model-b" },
    ],
    request,
    (candidate) => {
      selected = candidate;
    }
  );
  const result = streamText({ maxRetries: 0, model: route, prompt: "Hello" });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "OK");
  assert.deepEqual(selected, { provider: "gemini", upstreamId: "model-b" });
  assert.equal(used.length, 2);
  assert.ok(used[0].endsWith(":model-a"));
  assert.ok(used[1].endsWith(":model-b"));
});
