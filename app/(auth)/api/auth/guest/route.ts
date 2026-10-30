import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { applicationOrigin } from "@/lib/server/conversations/authorization";

export async function GET(request: Request) {
  const origin = applicationOrigin(request.url);
  if (!origin) {
    return new Response("Service unavailable", { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  let redirectUrl = "/";
  if (rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")) {
    try {
      const target = new URL(rawRedirect, origin);
      if (target.origin === origin) {
        redirectUrl = `${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      // Invalid destinations are safely ignored.
    }
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return NextResponse.redirect(new URL(`${base}/`, origin));
  }

  try {
    // Use an explicit response so a guest provisioning failure can degrade
    // gracefully instead of turning every entry point into a blank HTTP 500.
    const destination = await signIn("guest", {
      redirect: false,
      redirectTo: redirectUrl,
    });
    const result = new URL(destination, origin);
    return NextResponse.redirect(
      result.origin === origin ? result : new URL("/", origin)
    );
  } catch {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return NextResponse.redirect(
      new URL(`${base}/login?guest=unavailable`, origin)
    );
  }
}
