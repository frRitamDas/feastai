import type { ChatMessage } from "@/lib/types";

type ClientMessage = { id: string; parts: Record<string, unknown>[] };

/** Merge only user approval decisions into pending, server-stored tool calls. */
export function mergeToolApprovals(
  stored: ChatMessage[],
  submitted: ClientMessage[]
): ChatMessage[] | null {
  const responses = new Map<
    string,
    { id: string; approved: boolean; reason?: string }
  >();
  for (const message of submitted) {
    for (const part of message.parts) {
      if (
        part.state !== "approval-responded" ||
        typeof part.toolCallId !== "string"
      ) {
        continue;
      }
      const { approval } = part;
      if (
        !approval ||
        typeof approval !== "object" ||
        !("id" in approval) ||
        !("approved" in approval) ||
        typeof approval.id !== "string" ||
        typeof approval.approved !== "boolean"
      ) {
        return null;
      }
      const reason = "reason" in approval ? approval.reason : undefined;
      if (
        reason !== undefined &&
        (typeof reason !== "string" || reason.length > 500)
      ) {
        return null;
      }
      const key = `${message.id}:${part.toolCallId}`;
      if (responses.has(key)) {
        return null;
      }
      responses.set(key, {
        approved: approval.approved,
        id: approval.id,
        ...(reason ? { reason } : {}),
      });
    }
  }
  let matched = 0;
  const result = stored.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        !("toolCallId" in part) ||
        !("state" in part) ||
        part.state !== "approval-requested" ||
        !("approval" in part) ||
        !part.approval
      ) {
        return part;
      }
      const response = responses.get(`${message.id}:${part.toolCallId}`);
      if (!response || response.id !== part.approval.id) {
        return part;
      }
      matched += 1;
      return {
        ...part,
        approval: response,
        state: "approval-responded" as const,
      };
    }),
  }));
  return matched > 0 ? result : null;
}
