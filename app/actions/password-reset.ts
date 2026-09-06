"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { consumeResetToken, requestResetToken } from "@/lib/password-reset-store";
import {
  RESET_REQUESTED_MESSAGE,
  RESET_TOKEN_TTL_MINUTES,
  resetTokenMessage,
} from "@/lib/password-reset";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validation/auth";
import type { AuthFormState } from "@/app/actions/auth";
import { emailConfig } from "@/lib/email/config";
import { passwordResetEmail } from "@/lib/email/messages";
import { sendEmail } from "@/lib/email/send";

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Ask for a password reset link.
 *
 * Everything that could distinguish one address from another is deliberately
 * flattened: the same message, and no early return that would make a
 * registered address measurably slower than an unregistered one.
 *
 * The send failing does not change the answer either. Telling somebody "we
 * couldn't send that" would report on the existence of the account just as
 * loudly as saying so directly, and the operator has the real reason in the
 * log — see lib/email/send.ts, which never throws and always logs.
 */
export type ForgotPasswordState =
  | {
      /** The confirmation. Not an error — this form's success IS a sentence. */
      notice?: string;
      fieldErrors?: Record<string, string>;
      /** Echoed back so a rejected address does not have to be retyped. */
      email?: string;
    }
  | undefined;

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: String(formData.get("email") ?? ""),
  });
  // The one thing worth saying differently, because it is about what they
  // typed rather than about who has an account.
  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      email: String(formData.get("email") ?? ""),
    };
  }

  const config = emailConfig();
  if (config) {
    const issued = await requestResetToken(parsed.data.email);
    if (issued) {
      await sendEmail(
        passwordResetEmail({
          to: parsed.data.email,
          resetUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(issued.token)}`,
          ttlMinutes: RESET_TOKEN_TTL_MINUTES,
        }),
      );
    }
  }

  return { notice: RESET_REQUESTED_MESSAGE };
}

/**
 * Set a new password from a reset link.
 *
 * The token comes from a hidden field rather than being re-read from the URL,
 * so the value validated on submit is the one the page was rendered for.
 *
 * On success the user is signed straight in. They have just proved control of
 * the reset link and chosen the password, so bouncing them to a login form to
 * type it again adds a step and no security.
 */
export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const parsed = resetPasswordSchema.safeParse({
    token,
    password,
    confirmPassword,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const outcome = await consumeResetToken(parsed.data.token, parsed.data.password);
  if (!outcome.ok) {
    // Every failure reads the same way to whoever is holding the link — see
    // resetTokenMessage.
    return { error: resetTokenMessage(outcome.state) ?? "That link isn't valid." };
  }

  try {
    await signIn("credentials", {
      email: outcome.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // signIn throws a redirect on success — let that propagate.
    if (error instanceof AuthError) {
      // The password IS changed at this point; only the convenience login
      // failed. Say so, rather than implying the reset did not happen.
      return { error: "Password updated. Please log in." };
    }
    throw error;
  }
  return undefined;
}
