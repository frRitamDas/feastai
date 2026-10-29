/** Routing inputs must be server-owned observations, never browser assertions. */
export type RouteCandidate = {
  id: string;
  providerEnabled: boolean;
  keyEnabled: boolean;
  modelEnabled: boolean;
  keyPermitted: boolean;
  supportsVision: boolean | null;
  cooldownUntil: number | null;
  priority: number;
  latencyMs: number | null;
  successRate: number | null;
};

export type RoutingStrategy = "manual" | "fastest" | "reliable" | "balanced";

function usableNumber(value: number | null, max: number): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : null;
}

/** Only pre-authorized endpoints may be ranked; unknown vision is not support. */
export function rankCandidates(
  candidates: RouteCandidate[],
  options: { strategy: RoutingStrategy; requiresVision: boolean; now: number }
): RouteCandidate[] {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.providerEnabled &&
      candidate.keyEnabled &&
      candidate.modelEnabled &&
      candidate.keyPermitted &&
      (!options.requiresVision || candidate.supportsVision === true) &&
      (candidate.cooldownUntil === null ||
        (Number.isFinite(candidate.cooldownUntil) &&
          candidate.cooldownUntil <= options.now))
  );

  const score = (candidate: RouteCandidate): number => {
    const latency = usableNumber(candidate.latencyMs, 600_000);
    const reliability = usableNumber(candidate.successRate, 1);
    switch (options.strategy) {
      case "manual":
        return 0;
      case "fastest":
        return latency === null ? Number.POSITIVE_INFINITY : latency;
      case "reliable":
        return reliability === null
          ? Number.POSITIVE_INFINITY
          : 1 - reliability;
      case "balanced":
        // Unknown is not treated as healthy or fast.
        return latency === null || reliability === null
          ? Number.POSITIVE_INFINITY
          : latency / 60_000 + 1 - reliability;
      default:
        return Number.POSITIVE_INFINITY;
    }
  };

  return [...eligible].sort((a, b) => {
    const aScore = score(a);
    const bScore = score(b);
    if (aScore < bScore) {
      return -1;
    }
    if (aScore > bScore) {
      return 1;
    }
    return a.priority - b.priority || a.id.localeCompare(b.id);
  });
}

/** Streaming cannot be replayed after output or side effects have begun. */
export function mayTryFallback(options: {
  attempts: number;
  maxAttempts: number;
  outputStarted: boolean;
  hasSideEffects: boolean;
  error: "timeout" | "rate_limit" | "unavailable" | "auth" | "invalid_request";
}): boolean {
  return (
    !options.outputStarted &&
    !options.hasSideEffects &&
    options.attempts < options.maxAttempts &&
    ["timeout", "rate_limit", "unavailable"].includes(options.error)
  );
}
