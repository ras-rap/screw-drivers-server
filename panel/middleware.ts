import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const clerkOn =
  process.env.PANEL_DEV_AUTH !== "1" &&
  Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Pages are protected here so nothing renders for an anonymous visitor; `/sign-in` has to
 * stay public, and API routes answer 401/403 themselves (see requireViewer).
 *
 * Path checks are plain string tests rather than the deprecated createRouteMatcher()
 * helper - Clerk Core 3 pushes auth checks towards the resource being loaded, and the
 * routes already re-check the viewer (defence in depth, not a substitute).
 */
export default clerkOn
  ? clerkMiddleware(async (auth, request) => {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/sign-in") || pathname.startsWith("/api")) return;
      // auth.protect() answers 404 to anonymous page loads; a redirect to the sign-in
      // page is what a person expects to see.
      const { userId } = await auth();
      if (!userId) return NextResponse.redirect(new URL("/sign-in", request.url));
    })
  : function noAuth(_request: NextRequest) {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)", "/(api|trpc)(.*)"],
};
