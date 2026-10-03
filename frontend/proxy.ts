import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Route protection.
 *
 * `/` is public (it is the marketing page), as are the two auth routes: `/sign-up`
 * must stay reachable while signed out, because that is where an invited member
 * lands from the link in their invitation email and `auth.protect()` would
 * otherwise bounce them straight back to `/sign-in`. Everything else requires a
 * session. `/no-access` stays reachable while signed in, because that is where a
 * signed-in-but-not-invited user lands.
 *
 * This is the Next 16 `proxy` convention; the previous `middleware` name is
 * deprecated. The exported function is Clerk's wrapper, which Next invokes with
 * the request and which applies the matcher below.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in",
  "/sign-up",
  "/no-access",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  },
  {
    // Without these, `auth.protect()` bounces users to Clerk's hosted pages on
    // *.accounts.dev instead of the sign-in screen this app actually renders, so
    // signing in would drop people out of the design entirely.
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  }
);

export const config = {
  matcher: [
    // Everything except Next internals and static files, which never need auth
    // and would only add latency if Clerk ran on them.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};