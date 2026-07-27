// Controls who is allowed to create an account.
//
// Once the app is deployed at a public URL, anyone who can reach it can sign up
// — and every account can spend YOUR Anthropic credits. SIGNUP_ALLOWED_EMAILS
// restricts registration to a comma-separated list of addresses.
//
// Unset = open registration. That is convenient locally and dangerous in
// production, so isSignupRestricted() is surfaced in the UI and the deployment
// guide calls it out explicitly.

/** The configured allowlist, normalized. Empty means "no restriction". */
function allowedEmails(): string[] {
  return (process.env.SIGNUP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSignupRestricted(): boolean {
  return allowedEmails().length > 0;
}

/** True when this address may register. Always true if no list is configured. */
export function isEmailAllowedToSignUp(email: string): boolean {
  const list = allowedEmails();
  if (list.length === 0) return true;
  return list.includes(email.trim().toLowerCase());
}
