// Zod schemas for auth forms. These are the single source of truth for what a
// valid email / password / name looks like, used by both the server actions and
// the Credentials provider's authorize().
import { z } from "zod";
import { isValidCountryCode } from "@/lib/data/countries";
import { AGE_MESSAGES, checkAge } from "./age";

/**
 * Email addresses are stored lowercased, so every schema that looks one up
 * must normalize identically. Without this, signing up as "Me@Example.com"
 * stores "me@example.com" and then logging in with the address as typed fails
 * with "invalid email or password" — a bug that looks exactly like a wrong
 * password.
 */
const normalizedEmail = z
  .email({ error: "Enter a valid email address." })
  .transform((v) => v.trim().toLowerCase());

export const loginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1, { error: "Password is required." }),
});

/** Asking for a reset link. The address is all it takes. */
export const forgotPasswordSchema = z.object({ email: normalizedEmail });

/**
 * Which of the three products this account is for.
 *
 * Asked once, at signup, and it decides what gets created — a student profile,
 * a counselor's caseload, or a test-prep tutor's roster — rather than merely
 * which screen appears first. A "mode toggle" on one account would be the wrong
 * shape: both professional surfaces hold other families' children under
 * revocable grants, and that is not something an account should be able to
 * switch itself into.
 *
 * COUNSELOR and TUTOR are DIFFERENT PRODUCTS, not two names for one. See the
 * note on CounselorAccount.type: a counselor's scarce resource is attention
 * across a caseload, a tutor's is knowing what score to aim at and when to
 * stop. They share the consent machinery and nothing else, and until this
 * value existed the tutor edition had no front door at all — signup could only
 * ever make a counselor.
 */
export const ACCOUNT_KINDS = ["STUDENT", "COUNSELOR", "TUTOR"] as const;
export const accountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** The kinds that open a professional surface and need a practice name. */
export const PROFESSIONAL_KINDS = ["COUNSELOR", "TUTOR"] as const;
export function isProfessionalKind(kind: AccountKind): boolean {
  return (PROFESSIONAL_KINDS as readonly string[]).includes(kind);
}

/**
 * The CounselorAccount.type each professional kind creates.
 *
 * The form value and the stored type are deliberately different vocabularies:
 * the form says what a person is, the column says which product the row
 * belongs to. Mapping them here, once, is what keeps signup from ever writing
 * a type the layouts do not route.
 */
export const ACCOUNT_TYPE_FOR_KIND = {
  COUNSELOR: "INDEPENDENT",
  TUTOR: "TEST_PREP_TUTOR",
} as const;

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, { error: "Name is required." }).max(100),
    email: normalizedEmail,
    password: z
      .string()
      .min(8, { error: "Password must be at least 8 characters." })
      .max(200),
    // Defaulted rather than required, so a form posted without the field — an
    // older cached page, a script — creates the LESS privileged account rather
    // than failing open into a caseload.
    accountKind: accountKindSchema.default("STUDENT"),
    countryOfOrigin: z
      .string()
      .trim()
      .refine((c) => c === "" || isValidCountryCode(c), {
        error: "Choose a country from the list.",
      })
      .optional(),
    orgName: z.string().trim().max(120).optional(),
    /**
     * Date of birth, screened against MINIMUM_AGE_YEARS.
     *
     * Required for EVERY account kind, not only students. A gate that applied
     * to students alone would be one a twelve-year-old walks through by
     * choosing "counselor" on the previous question, which is not a gate.
     *
     * Coerced from the form's string here so the rule below compares dates
     * rather than parsing them.
     */
    dateOfBirth: z.coerce.date({ error: "Enter your date of birth." }),
  })
  .refine(
    (v) => !isProfessionalKind(v.accountKind) || (v.orgName ?? "").length > 0,
    {
      error: "Tell us what your practice is called — students will see it.",
      path: ["orgName"],
    },
  )
  .superRefine((v, ctx) => {
    // superRefine rather than refine: the message depends on WHICH way the
    // date is unacceptable, and refine takes a fixed one.
    const result = checkAge(v.dateOfBirth);
    if (result.ok) return;
    ctx.addIssue({
      code: "custom",
      message: AGE_MESSAGES[result.reason],
      path: ["dateOfBirth"],
    });
  });

/**
 * Setting a new password from a reset link.
 *
 * The same 8-character floor as signup, deliberately shared rather than
 * retyped: a reset path that accepts a weaker password than registration does
 * is a way around the rule, not a separate rule.
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, { error: "This link is missing its token." }),
    password: z
      .string()
      .min(8, { error: "Password must be at least 8 characters." })
      .max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    error: "Both passwords must match.",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
