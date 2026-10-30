import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";
import { createProviderModel } from "../../lib/server/providers/inference";

test("compatible provider streams the selected upstream model using a server-side credential", async () => {
  let body: Record<string, unknown> | undefined;
  const mock: typeof fetch = (url, options) => {
    assert.equal(
      String(url),
      "https://api.groq.com/openai/v1/chat/completions"
    );
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer mock-credential"
    );
    body = JSON.parse(String(options?.body));
    const events = [
      {
        choices: [
          {
            delta: { content: "Hello", role: "assistant" },
            finish_reason: null,
            index: 0,
          },
        ],
        id: "1",
        model: "selected-model",
      },
      {
        choices: [
          { delta: { content: " world" }, finish_reason: null, index: 0 },
        ],
        id: "1",
        model: "selected-model",
      },
      {
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        id: "1",
        model: "selected-model",
      },
    ];
    return Promise.resolve(
      new Response(
        `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      )
    );
  };
  const result = streamText({
    maxRetries: 0,
    model: createProviderModel(
      "groq",
      "selected-model",
      "mock-credential",
      mock
    ),
    prompt: "Hi",
  });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  assert.equal(text, "Hello world");
  assert.equal(body?.model, "selected-model");
  assert.equal(body?.stream, true);
});

test("Gemini streams through Google's fixed OpenAI-compatible endpoint", async () => {
  const mock: typeof fetch = (url, options) => {
    assert.equal(
      String(url),
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer mock-google-key"
    );
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gemini-test");
    return Promise.resolve(
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello", role: "assistant" }, finish_reason: null, index: 0 }], id: "1" })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }], id: "1" })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      )
    );
  };
  const stream = streamText({
    maxRetries: 0,
    model: createProviderModel(
      "gemini",
      "gemini-test",
      "mock-google-key",
      mock
    ),
    prompt: "Hi",
  });
  let result = "";
  for await (const chunk of stream.textStream) {
    result += chunk;
  }
  assert.equal(result, "Hello");
});
