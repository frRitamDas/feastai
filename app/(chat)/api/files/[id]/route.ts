import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getPrivateAttachment } from "@/lib/db/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id || !z.uuid().safeParse(id).success) {
    return new Response(null, { status: 404 });
  }
  const file = await getPrivateAttachment(session.user.id, id);
  if (!file) {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": file.mediaType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
