import { auth } from "@/app/(auth)/auth";
import { searchChatsByUserId } from "@/lib/db/queries";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 100) {
    return Response.json(
      { error: "Enter a search of 1 to 100 characters" },
      { status: 400 }
    );
  }
  const chats = await searchChatsByUserId({ id: session.user.id, query });
  return Response.json(
    { chats },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
