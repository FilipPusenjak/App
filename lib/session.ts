// Small helper for reading the current authenticated user in server code.
// Returns the session user (with `id`) or null. Route/layout guards and the
// ownership helpers build on this.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The signed-in user, or null.
 *
 * A valid session cookie is NOT sufficient on its own. Sessions here are JWTs,
 * which means they keep asserting a user id long after the row behind it may
 * have gone:
 *   - the account was deleted (possibly from another device, while this session
 *     was still live),
 *   - or the database was reset or swapped underneath the app.
 *
 * Trusting the cookie in either case produced a hard crash rather than a
 * redirect: the app would try to create a profile for a user that no longer
 * exists and hit a foreign key violation. So the id is confirmed against the
 * database, and a session pointing at a missing user is treated as signed out.
 *
 * The cost is one indexed primary-key lookup per request that needs the user.
 * That is also the standard fix for JWT sessions outliving revoked access — a
 * deleted account loses access immediately instead of when the token expires.
 */
export async function getCurrentUser() {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser?.id) return null;

  const stillExists = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true },
  });
  if (!stillExists) return null;

  return sessionUser;
}

/**
 * Returns the authenticated user's id, or throws. Use in server code that must
 * never run for an unauthenticated request. Pages should still guard + redirect;
 * this is the last-line assertion for data access.
 */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user?.id) {
    throw new Error("Not authenticated");
  }
  return user.id;
}
