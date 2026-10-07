// Where a privacy request goes.
//
// An env var rather than a literal, because the address is the operator's and
// does not belong in the repository. Falls back to the password-reset contact
// already configured for the forgot-password page, since both are "a human who
// can act on an account". Google Play requires a privacy contact on the policy,
// so leaving both unset is a store-submission blocker — see docs/app-store.md.
export function privacyContact(): string | null {
  const explicit = process.env.PRIVACY_CONTACT?.trim();
  if (explicit) return explicit;
  return process.env.PASSWORD_RESET_CONTACT?.trim() || null;
}
