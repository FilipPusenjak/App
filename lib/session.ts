// Small helper for reading the current authenticated user in server code.
// Route/layout guards and the ownership helpers build on this.
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The signed-in user's database row, or null.
 *
 * A valid session cookie is NOT sufficient on its own. Sessions here are JWTs,
 * which keep asserting a user id long after the row behind it may have gone —
 * the account was deleted (possibly from another device while this session was
 * live), or the database was reset underneath the app. Trusting the cookie in
 * either case produced a hard crash rather than a redirect, so the id is
 * confirmed against the database and a session pointing at a missing user is
 * treated as signed out.
 *
 * Wrapped in React's cache() so this runs ONCE per request no matter how many
 * callers ask. Rendering a page can involve the layout guard, the page itself,
 * and an ownership helper all needing the user; without deduplication that was
 * three identical round trips, which is invisible against a local database and
 * very much not invisible against a hosted one.
 *
 * Fields commonly needed alongside the check are selected here too, so callers
 * don't issue a second query for them.
 */
export const getCurrentDbUser = cache(async () => {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) return null;

  return prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      email: true,
      name: true,
      countryOfOrigin: true,
    },
  });
});

/** The signed-in user, or null. Deduplicated per request. */
export async function getCurrentUser() {
  return getCurrentDbUser();
}

/**
 * Returns the authenticated user's id, or throws. Use in server code that must
 * never run for an unauthenticated request. Pages should still guard + redirect;
 * this is the last-line assertion for data access.
 */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentDbUser();
  if (!user?.id) {
    throw new Error("Not authenticated");
  }
  return user.id;
}
