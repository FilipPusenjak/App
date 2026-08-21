// Zod schemas for auth forms. These are the single source of truth for what a
// valid email / password / name looks like, used by both the server actions and
// the Credentials provider's authorize().
import { z } from "zod";
import { isValidCountryCode } from "@/lib/data/countries";

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

/**
 * Which of the two products this account is for.
 *
 * Asked once, at signup, and it decides what gets created — a student profile
 * or a caseload — rather than merely which screen appears first. A "mode
 * toggle" on one account would be the wrong shape: the counselor surface holds
 * other families' children under revocable grants, and that is not something an
 * account should be able to switch itself into.
 */
export const ACCOUNT_KINDS = ["STUDENT", "COUNSELOR"] as const;
export const accountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

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
  })
  .refine(
    (v) => v.accountKind !== "COUNSELOR" || (v.orgName ?? "").length > 0,
    {
      error: "Tell us what your practice is called — students will see it.",
      path: ["orgName"],
    },
  );

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
