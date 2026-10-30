import { ipAddress } from "@vercel/functions";
import { auth } from "@/app/(auth)/auth";
import { savePrivateAttachment } from "@/lib/db/queries";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { isSameOrigin } from "@/lib/server/conversations/authorization";
import { isSafeImage, isSafeText } from "@/lib/server/security/attachments";
import { readLimitedBytes } from "@/lib/server/security/read-limited-json";

export async function POST(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await enforceIpRateLimit(ipAddress(request), "upload");
    await enforceIpRateLimit(session.user.id, "upload");
    const body = await readLimitedBytes(request, 2 * 1024 * 1024 + 16_384);
    const multipart = new Request(request.url, {
      body,
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      method: "POST",
    });
    const form = await multipart.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.name.length > 100) {
      return Response.json({ error: "Invalid image" }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!(isSafeImage(bytes, file.type) || isSafeText(bytes, file.type))) {
      return Response.json(
        {
          error:
            "Use a JPEG/PNG image up to 2 MB or UTF-8 text file up to 32 KB.",
        },
        { status: 400 }
      );
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
    const id = await savePrivateAttachment(
      session.user.id,
      safeName,
      file.type,
      bytes
    );
    if (!id) {
      return Response.json(
        { error: "Attachment storage quota reached." },
        { status: 413 }
      );
    }
    return Response.json(
      {
        contentType: file.type,
        pathname: safeName,
        url: new URL(`/api/files/${id}`, request.url).toString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "Upload unavailable" }, { status: 503 });
  }
}
