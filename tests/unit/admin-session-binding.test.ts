import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sessionBinding } from "../../lib/server/admin/session-binding";

test("session binding survives JWT rotation but remains unique per login", () => {
  const login = randomUUID();
  const otherLogin = randomUUID();
  assert.equal(
    sessionBinding({ graceSessionBinding: login, jti: randomUUID() }),
    login
  );
  assert.notEqual(
    sessionBinding({ graceSessionBinding: otherLogin, jti: randomUUID() }),
    login
  );
});

test("legacy sessions adopt their original Auth.js jti once", () => {
  const oldJti = randomUUID();
  assert.equal(sessionBinding({ jti: oldJti }), oldJti);
  assert.equal(
    sessionBinding({ graceSessionBinding: oldJti, jti: randomUUID() }),
    oldJti
  );
  assert.equal(sessionBinding({}), null);
  assert.equal(
    sessionBinding({ graceSessionBinding: "invalid", jti: oldJti }),
    null
  );
});
