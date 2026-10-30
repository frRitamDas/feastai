// biome-ignore-all lint/suspicious/useAwait: Fetch mocks must return promises.
"use strict";
// Test-process-only provider stub. Never loaded by the production application.
const originalFetch = globalThis.fetch;
let firstProviderFailed = false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  // Explicitly enabled only in the isolated browser fixture. This never runs
  // in the deployed application and does not weaken real Turnstile checks.
  if (
    process.env.GRACE_INTEGRATION_MOCK_TURNSTILE === "1" &&
    url === "https://challenges.cloudflare.com/turnstile/v0/siteverify"
  ) {
    const body = new URLSearchParams(init?.body);
    return Response.json({
      action: "register",
      hostname: "localhost",
      success:
        body.get("secret") === "integration-only-turnstile-secret" &&
        body.get("response") === "integration-valid-challenge",
    });
  }
  if (url.startsWith("https://api.groq.com/openai/v1/")) {
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "integration-model" }] });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.stream) {
      if (
        new Headers(init?.headers).get("authorization") ===
        "Bearer rate-limited-key"
      ) {
        firstProviderFailed = true;
        return Response.json({ error: { message: "busy" } }, { status: 503 });
      }
      const messages = JSON.stringify(body.messages);
      if (
        !firstProviderFailed ||
        (!messages.includes("Secret memo for Grace") &&
          !messages.includes("data:image/png;base64,"))
      ) {
        return Response.json(
          { error: { message: "Missing attachment content" } },
          { status: 400 }
        );
      }
      const data = [
        {
          choices: [
            {
              delta: {
                content: "Hello from the mock model",
                role: "assistant",
              },
              finish_reason: null,
              index: 0,
            },
          ],
          id: "test-stream",
          model: "integration-model",
        },
        {
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          id: "test-stream",
          model: "integration-model",
          usage: { completion_tokens: 4, prompt_tokens: 3, total_tokens: 7 },
        },
      ];
      return new Response(
        `${data.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      );
    }
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "OK", role: "assistant" },
        },
      ],
      id: "test-verify",
      model: "integration-model",
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
    });
  }
  if (url.startsWith("https://ai-gateway.vercel.sh/")) {
    return new Response(null, { status: 503 });
  }
  return originalFetch(input, init);
};
