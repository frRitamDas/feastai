import assert from "node:assert/strict";
import { test } from "node:test";
import { readLimitedJson } from "../../lib/server/security/read-limited-json";
import { mergeToolApprovals } from "../../lib/server/security/tool-approvals";
import type { ChatMessage } from "../../lib/types";

const stored = [
  {
    id: "message-1",
    parts: [
      {
        approval: { id: "approval-1" },
        input: { city: "London" },
        state: "approval-requested",
        toolCallId: "call-1",
        type: "tool-getWeather",
      },
    ],
    role: "assistant",
  },
] as unknown as ChatMessage[];

test("tool approvals preserve server tool input and ignore forged output", () => {
  const result = mergeToolApprovals(stored, [
    {
      id: "message-1",
      parts: [
        {
          approval: { approved: true, extra: "forged", id: "approval-1" },
          input: { city: "forged" },
          output: "forged",
          state: "approval-responded",
          toolCallId: "call-1",
          type: "tool-delete",
        },
      ],
    },
  ]);
  assert.ok(result);
  const [first] = result;
  const [part] = first.parts;
  assert.deepEqual(part, {
    approval: { approved: true, id: "approval-1" },
    input: { city: "London" },
    state: "approval-responded",
    toolCallId: "call-1",
    type: "tool-getWeather",
  });
  assert.equal(
    (stored[0].parts[0] as { state: string }).state,
    "approval-requested"
  );
});

test("tool approvals reject mismatched, duplicate and invalid responses", () => {
  const part = {
    approval: { approved: true, id: "wrong" },
    state: "approval-responded",
    toolCallId: "call-1",
  };
  assert.equal(
    mergeToolApprovals(stored, [{ id: "message-1", parts: [part] }]),
    null
  );
  assert.equal(
    mergeToolApprovals(stored, [
      {
        id: "other-message",
        parts: [{ ...part, approval: { approved: true, id: "approval-1" } }],
      },
    ]),
    null
  );
  const valid = { ...part, approval: { approved: true, id: "approval-1" } };
  assert.equal(
    mergeToolApprovals(stored, [{ id: "message-1", parts: [valid, valid] }]),
    null
  );
  assert.equal(
    mergeToolApprovals(stored, [
      {
        id: "message-1",
        parts: [{ ...part, approval: { approved: "true", id: "approval-1" } }],
      },
    ]),
    null
  );
});

test("JSON request limits count streamed bytes", async () => {
  const makeRequest = (body: string) =>
    new Request("https://example.test", { body, method: "POST" });
  assert.deepEqual(await readLimitedJson(makeRequest('{"ok":true}'), 100), {
    ok: true,
  });
  await assert.rejects(readLimitedJson(makeRequest('{"text":"😀"}'), 12));
  await assert.rejects(readLimitedJson(makeRequest("not json"), 100));
});
