import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const clerkOn =
  process.env.PANEL_DEV_AUTH !== "1" &&
  Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Sign-in must stay public; API routes answer 401/403 themselves. */
const isPublic = createRouteMatcher(["/sign-in(.*)", "/api(.*)"]);

export default clerkOn
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublic(request)) await auth.protect();
    })
  : function noAuth(_request: NextRequest) {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)", "/(api|trpc)(.*)"],
};
