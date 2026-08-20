// Deciding whether two commitments are the same undertaking.
//
// Pure, and deliberately CONSERVATIVE. This is the backstop behind a prompt
// instruction, not the primary defence: the review is shown what the student
// already accepted and told not to propose it again. This only catches the
// case where it did so anyway, in the same words.
//
// It does not do fuzzy matching, and that is the whole design. "Send the
// write-up to your physics teacher" and "Send the write-up to a teacher" are
// close enough that any similarity threshold loose enough to catch the pair
// would also catch two genuinely different commitments about the same
// activity — and silently dropping a real proposal is worse than showing a
// near-duplicate. A student can decline a duplicate in one click. They cannot
// recover a proposal the app threw away without telling them.
//
// No database, no session: importable from anywhere, including a test that
// wants to check the rule without a Postgres.

/**
 * The comparable form of a commitment description.
 *
 * Case, surrounding whitespace, internal runs of whitespace and trailing
 * punctuation are all noise — a model that emits the same sentence twice may
 * differ on any of them. Everything else is signal and is left alone.
 */
export function normalizeDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,]+$/, "");
}

/** True when these are the same undertaking written out twice. */
export function sameCommitment(a: string, b: string): boolean {
  return normalizeDescription(a) === normalizeDescription(b);
}

/**
 * Which of a review's proposals should become rows.
 *
 * Anything the student is ALREADY on the hook for is dropped: re-proposing an
 * accepted commitment asks them to agree to something they have already agreed
 * to, and it would then appear twice in "do this next" and twice in every
 * check-in — with the copy they accepted weeks ago sitting next to a fresh
 * proposal of the same thing.
 *
 * Note what is NOT compared against: proposals from earlier reviews. The caller
 * supersedes those before reading, so by the time this runs they are no longer
 * open and a repeat replaces its predecessor rather than stacking beside it.
 * That ordering matters — filtering against still-open earlier proposals would
 * leave a student who ignored one once never being asked again.
 */
export function commitmentsToWrite<T extends { description: string }>(
  proposals: T[],
  alreadyOpen: { description: string }[],
): T[] {
  const open = new Set(alreadyOpen.map((c) => normalizeDescription(c.description)));
  const seen = new Set<string>();
  const out: T[] = [];

  for (const proposal of proposals) {
    const key = normalizeDescription(proposal.description);
    // The second guard is for one review proposing the same thing twice in a
    // single response — rarer, and just as confusing on screen.
    if (open.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(proposal);
  }
  return out;
}
