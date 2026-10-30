import { auth } from "@/app/(auth)/auth";
import { clearUnusedAttachments } from "@/lib/db/queries";
import { isSameOrigin } from "@/lib/server/conversations/authorization";

export async function DELETE(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const removed = await clearUnusedAttachments(session.user.id);
  return Response.json(
    { removed },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
