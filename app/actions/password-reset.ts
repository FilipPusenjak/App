"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { consumeResetToken } from "@/lib/password-reset-store";
import { resetTokenMessage } from "@/lib/password-reset";
import { resetPasswordSchema } from "@/lib/validation/auth";
import type { AuthFormState } from "@/app/actions/auth";

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
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
