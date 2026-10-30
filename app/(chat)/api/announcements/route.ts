import { auth } from "@/app/(auth)/auth";
import { getPublishedAnnouncements } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const announcements = await getPublishedAnnouncements();
  return Response.json(
    { announcements },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
