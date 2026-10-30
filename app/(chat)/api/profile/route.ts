import { ipAddress } from "@vercel/functions";
import { compare } from "bcrypt-ts";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getProfile, updateProfile } from "@/lib/db/queries";
import { generateHashedPassword } from "@/lib/db/utils";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { isSameOrigin } from "@/lib/server/conversations/authorization";
import { readLimitedJson } from "@/lib/server/security/read-limited-json";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const schema = z
  .object({
    currentPassword: z.string().max(72).optional(),
    name: z.string().trim().max(100),
    newPassword: z.string().min(8).max(72).optional(),
  })
  .strict()
  .refine((value) => !value.newPassword || Boolean(value.currentPassword))
  .refine(
    (value) => !value.newPassword || Buffer.byteLength(value.newPassword) <= 72
  );

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.type !== "regular") {
    return Response.json(
      { error: "Sign in required" },
      { headers, status: 401 }
    );
  }
  const profile = await getProfile(session.user.id);
  if (!profile || profile.isAnonymous) {
    return Response.json(
      { error: "Account not found" },
      { headers, status: 404 }
    );
  }
  return Response.json(
    { email: profile.email, name: profile.name ?? "" },
    { headers }
  );
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Invalid origin" }, { headers, status: 403 });
  }
  const session = await auth();
  if (!session?.user?.id || session.user.type !== "regular") {
    return Response.json(
      { error: "Sign in required" },
      { headers, status: 401 }
    );
  }
  let data: z.infer<typeof schema>;
  try {
    data = schema.parse(await readLimitedJson(request, 4096));
  } catch {
    return Response.json(
      { error: "Invalid profile" },
      { headers, status: 400 }
    );
  }
  const profile = await getProfile(session.user.id);
  if (!profile || profile.isAnonymous) {
    return Response.json(
      { error: "Account not found" },
      { headers, status: 404 }
    );
  }
  if (data.newPassword) {
    await enforceIpRateLimit(ipAddress(request), "login");
    await enforceIpRateLimit(session.user.id, "login");
    if (
      !profile.password ||
      !(await compare(data.currentPassword ?? "", profile.password))
    ) {
      return Response.json(
        { error: "Current password is incorrect" },
        { headers, status: 403 }
      );
    }
  }
  const ok = await updateProfile(
    session.user.id,
    data.name,
    profile.password,
    data.newPassword ? generateHashedPassword(data.newPassword) : null
  );
  if (!ok) {
    return Response.json(
      { error: "Account changed; try again" },
      { headers, status: 409 }
    );
  }
  return Response.json(
    { ok: true, sessionRevoked: Boolean(data.newPassword) },
    { headers }
  );
}
