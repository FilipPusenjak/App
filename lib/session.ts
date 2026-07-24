// Small helper for reading the current authenticated user in server code.
// Returns the session user (with `id`) or null. Route/layout guards and the
// ownership helpers (Milestone 3) build on this.
import { auth } from "@/lib/auth";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
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
