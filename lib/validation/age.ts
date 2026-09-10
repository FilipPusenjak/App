// The minimum age to hold an account, and how it is checked.
//
// PURE — no database, no clock of its own beyond what it is handed, so the
// boundary cases below can be tested directly rather than through a form.
//
// WHY 13. Under that, COPPA requires verifiable parental consent before an
// operator may collect personal information from a child in the US, and this
// app collects a great deal of it — grades, test scores, activities, a career
// goal, whatever a student types about themselves. Verifiable parental consent
// is a real mechanism with real requirements, not a checkbox, and this app
// implements none of it. So the honest position is that it does not accept
// accounts from under-13s at all.
//
// A NEUTRAL AGE SCREEN, not "are you over 13?". Asking for a date of birth
// without saying what the cut-off is, and without letting a rejected attempt be
// retried into an accepted one, is the practice regulators describe. A yes/no
// question tells a twelve-year-old exactly which answer opens the door.
//
// WHAT THIS IS NOT. It is not verification — nothing here proves an age, and no
// self-reported date could. It is the difference between not knowingly
// collecting from under-13s and not asking, which is the distinction that
// actually matters.
//
// SIXTEEN, NOT THIRTEEN, IN PARTS OF THE EU. GDPR lets member states set the
// digital-consent age anywhere from 13 to 16, and several are above 13. This
// file deliberately implements one floor rather than a country table: a wrong
// country table reads as compliance while being wrong, and the country a
// student picks on a signup form is not evidence of where they live. Raising
// the floor per country is a decision to make with a lawyer, and the shape here
// leaves room for it.

/** The floor, in years, for holding any account on this deployment. */
export const MINIMUM_AGE_YEARS = 13;

/**
 * Whole years elapsed, by calendar rather than by arithmetic on milliseconds.
 *
 * A year is not a fixed number of days — leap years exist — so dividing a
 * millisecond span by 365.25 gets the boundary wrong for somebody whose
 * birthday is today. Comparing month and day directly is exact.
 */
export function ageInYears(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();

  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  // Their birthday has not come round yet this year.
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;

  return age;
}

export type AgeCheck =
  | { ok: true; age: number }
  | { ok: false; reason: "missing" | "unparseable" | "future" | "too-young" | "implausible" };

/**
 * Is this date of birth one this deployment may accept?
 *
 * Every failure is its own reason so the form can say something useful, but
 * NONE of them says what the cut-off is — see the note on neutral screening at
 * the top. "You must be at least 13" on a rejection is the same hint as asking
 * the question outright, one attempt later.
 */
export function checkAge(
  birthDate: Date | null | undefined,
  now: Date = new Date(),
): AgeCheck {
  if (!birthDate) return { ok: false, reason: "missing" };
  if (Number.isNaN(birthDate.getTime())) {
    return { ok: false, reason: "unparseable" };
  }
  if (birthDate.getTime() > now.getTime()) {
    return { ok: false, reason: "future" };
  }

  const age = ageInYears(birthDate, now);

  // A typo in the year is far more likely than a 150-year-old, and accepting it
  // would store a date nobody meant. Caught separately from "too young" so the
  // message can suggest checking the year rather than implying a rejection.
  if (age > 120) return { ok: false, reason: "implausible" };

  if (age < MINIMUM_AGE_YEARS) return { ok: false, reason: "too-young" };

  return { ok: true, age };
}

/**
 * What the form says, per failure.
 *
 * The too-young case is deliberately the least specific of the four. It does
 * not name the age, does not say "come back when you are older", and reads the
 * same as any other refusal — a message that explains the rule is a message
 * that explains how to get around it.
 */
export const AGE_MESSAGES: Record<
  Extract<AgeCheck, { ok: false }>["reason"],
  string
> = {
  missing: "Enter your date of birth.",
  unparseable: "That is not a date we can read.",
  future: "That date has not happened yet.",
  implausible: "Check the year on that date.",
  "too-young": "This account cannot be created.",
};
