import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getMessagesByChatId,
  renameOwnedChat,
} from "@/lib/db/queries";
import {
  conversationAccess,
  isSameOrigin,
  renameConversationSchema,
} from "@/lib/server/conversations/authorization";

const uuid = z.uuid();
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in required" },
      { headers: privateHeaders, status: 401 }
    );
  }
  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return Response.json(
      { error: "Conversation not found" },
      { headers: privateHeaders, status: 404 }
    );
  }
  const chat = await getChatById({ id });
  if (!chat || conversationAccess(session.user.id, chat.userId) !== 200) {
    return Response.json(
      { error: "Conversation not found" },
      { headers: privateHeaders, status: 404 }
    );
  }
  const messages = await getMessagesByChatId({ id });
  return Response.json(
    {
      conversation: {
        createdAt: chat.createdAt,
        id: chat.id,
        messages: messages.map(({ id: messageId, role, parts, createdAt }) => ({
          createdAt,
          id: messageId,
          parts,
          role,
        })),
        title: chat.title,
      },
      product: "Grace AI",
      version: 1,
    },
    {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="grace-conversation-${id}.json"`,
      },
    }
  );
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in required" },
      { headers: privateHeaders, status: 401 }
    );
  }
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json(
      { error: "Invalid request origin" },
      { headers: privateHeaders, status: 403 }
    );
  }
  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return Response.json(
      { error: "Conversation not found" },
      { headers: privateHeaders, status: 404 }
    );
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request" },
      { headers: privateHeaders, status: 400 }
    );
  }
  const parsed = renameConversationSchema.safeParse(value);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter a title between 1 and 120 characters" },
      { headers: privateHeaders, status: 400 }
    );
  }
  const renamed = await renameOwnedChat({
    id,
    title: parsed.data.title,
    userId: session.user.id,
  });
  if (!renamed) {
    return Response.json(
      { error: "Conversation not found" },
      { headers: privateHeaders, status: 404 }
    );
  }
  return Response.json(
    { id: renamed.id, title: renamed.title },
    { headers: privateHeaders }
  );
}
