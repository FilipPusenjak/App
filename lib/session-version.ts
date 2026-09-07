// Whether a session token still speaks for the account it was minted for.
//
// Sessions are stateless JWTs: nothing on the server lists them, so nothing on
// the server can revoke one. What can be done is to make each token carry a
// number — the account's session version at the moment it was minted — and
// compare it against the account's current number on every request. Setting a
// new password bumps the number, and every token minted before that stops
// matching at once, on every device, without the server having heard of any
// of them.
//
// Pure, so the rule is testable without a database or a cookie. lib/session.ts
// applies it beside the existing "does the user row still exist" check, which
// already costs the one lookup this needs.

/**
 * True when the version the token carries is the version the account has.
 *
 * A token with NO version is treated as stale, not as current. The only tokens
 * without one were minted before the version existed, and the safe reading of
 * "this token predates the mechanism that would have revoked it" is that it
 * cannot be vouched for. The cost is one forced sign-in per device on the
 * deploy that introduces this, which is what the alternative — a pre-existing
 * hijacked session surviving the password reset meant to end it — is not worth.
 */
export function sessionIsCurrent(
  tokenVersion: unknown,
  accountVersion: number,
): boolean {
  return typeof tokenVersion === "number" && tokenVersion === accountVersion;
}
