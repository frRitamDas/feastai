import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mayTryFallback,
  type RouteCandidate,
  rankCandidates,
} from "../../lib/server/routing/policy";

const candidate: RouteCandidate = {
  cooldownUntil: null,
  id: "a",
  keyEnabled: true,
  keyPermitted: true,
  latencyMs: 100,
  modelEnabled: true,
  priority: 1,
  providerEnabled: true,
  successRate: 0.99,
  supportsVision: true,
};

test("routing requires all permissions, capabilities, and expired cooldown", () => {
  const options = {
    now: 100,
    requiresVision: true,
    strategy: "manual" as const,
  };
  const candidates = [
    candidate,
    { ...candidate, id: "disabled", keyEnabled: false },
    { ...candidate, id: "unpermitted", keyPermitted: false },
    { ...candidate, id: "unknown-vision", supportsVision: null },
    { ...candidate, cooldownUntil: 101, id: "limited" },
  ];
  assert.deepEqual(
    rankCandidates(candidates, options).map((item) => item.id),
    ["a"]
  );
  assert.equal(
    rankCandidates([{ ...candidate, cooldownUntil: 100 }], options).length,
    1
  );
});

test("measured signals sort ahead of unknown without mutating input", () => {
  const candidates = [
    { ...candidate, id: "unknown", latencyMs: null, priority: 0 },
    candidate,
  ];
  assert.deepEqual(
    rankCandidates(candidates, {
      now: 0,
      requiresVision: false,
      strategy: "fastest",
    }).map((item) => item.id),
    ["a", "unknown"]
  );
  assert.equal(candidates[0].id, "unknown");
});

test("fallback is bounded and never repeats after output or side effects", () => {
  const request = {
    attempts: 1,
    error: "rate_limit" as const,
    hasSideEffects: false,
    maxAttempts: 2,
    outputStarted: false,
  };
  assert.equal(mayTryFallback(request), true);
  assert.equal(mayTryFallback({ ...request, outputStarted: true }), false);
  assert.equal(mayTryFallback({ ...request, hasSideEffects: true }), false);
  assert.equal(mayTryFallback({ ...request, attempts: 2 }), false);
  assert.equal(mayTryFallback({ ...request, error: "invalid_request" }), false);
});
