import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationAccess,
  isSameOrigin,
  renameConversationSchema,
} from "../../lib/server/conversations/authorization";
import { escapeSearchTerm } from "../../lib/server/conversations/search";

test("conversation ownership is checked and other users cannot enumerate chats", () => {
  assert.equal(conversationAccess(undefined, "owner"), 401);
  assert.equal(conversationAccess("owner", "owner"), 200);
  assert.equal(conversationAccess("other", "owner"), 404);
  assert.equal(conversationAccess("other", undefined), 404);
});

test("conversation changes require a matching origin", () => {
  assert.equal(
    isSameOrigin(
      "https://graceorg.vercel.app/api/conversations/1",
      "https://graceorg.vercel.app"
    ),
    true
  );
  assert.equal(
    isSameOrigin(
      "https://graceorg.vercel.app/api/conversations/1",
      "https://evil.example"
    ),
    false
  );
  assert.equal(
    isSameOrigin("https://graceorg.vercel.app/api/conversations/1", null),
    false
  );
  assert.equal(
    isSameOrigin(
      "https://graceorg.vercel.app/api/conversations/1",
      "not-a-url"
    ),
    false
  );
});

test("rename rejects blank, oversized and extra input", () => {
  assert.deepEqual(renameConversationSchema.parse({ title: "  Hello  " }), {
    title: "Hello",
  });
  assert.equal(
    renameConversationSchema.safeParse({ title: "  " }).success,
    false
  );
  assert.equal(
    renameConversationSchema.safeParse({ title: "x".repeat(121) }).success,
    false
  );
  assert.equal(
    renameConversationSchema.safeParse({ owner: "other", title: "Hello" })
      .success,
    false
  );
});

test("search terms escape SQL LIKE wildcards", () => {
  assert.equal(escapeSearchTerm("100%_done"), "100\\%\\_done");
  assert.equal(escapeSearchTerm("path\\name"), "path\\\\name");
});
