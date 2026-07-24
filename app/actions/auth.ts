"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/lib/auth";
import { loginSchema, signupSchema } from "@/lib/validation/auth";

// Shape returned to the client forms (via useActionState). `undefined` = no
// error yet (initial render). On success the actions redirect, so they don't
// return a "success" state.
export type AuthFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: { name?: string; email?: string };
    }
  | undefined;

// Turn Zod issues into a { field: firstMessage } map for inline form errors.
function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues), values: { email } };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // signIn throws a redirect on success — let that propagate.
    if (error instanceof AuthError) {
      return { error: "Invalid email or password.", values: { email } };
    }
    throw error;
  }
  return undefined;
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const countryOfOrigin = String(formData.get("countryOfOrigin") ?? "");

  const parsed = signupSchema.safeParse({ name, email, password, countryOfOrigin });
  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      values: { name, email },
    };
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return {
      error: "An account with that email already exists.",
      values: { name, email },
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: normalizedEmail,
      passwordHash,
      countryOfOrigin: parsed.data.countryOfOrigin || null,
    },
  });

  // Log the new user straight in.
  try {
    await signIn("credentials", {
      email: normalizedEmail,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // Account was created but auto-login failed — send them to log in manually.
      return { error: "Account created. Please log in." };
    }
    throw error;
  }
  return undefined;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
