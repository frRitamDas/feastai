import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";
import { applicationOrigin } from "./lib/server/conversations/authorization";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (
    pathname.startsWith("/api/administrator/") ||
    pathname.startsWith("/administrator") ||
    pathname.startsWith("/api/conversations/") ||
    pathname === "/api/history/search"
  ) {
    // These endpoints return their own 401/404 instead of creating a guest.
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const isAuthPage = ["/login", "/register"].includes(pathname);

  // Account access must remain reachable even if guest provisioning is down.
  if (isAuthPage) {
    const isGuest = guestRegex.test(token?.email ?? "");
    if (token && !isGuest) {
      const origin = applicationOrigin(request.url);
      return origin
        ? NextResponse.redirect(new URL(`${base}/`, origin))
        : new Response("Service unavailable", { status: 503 });
    }
    return NextResponse.next();
  }

  if (!token) {
    const origin = applicationOrigin(request.url);
    if (!origin) {
      return new Response("Service unavailable", { status: 503 });
    }
    const redirectUrl = encodeURIComponent(pathname);

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, origin)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
