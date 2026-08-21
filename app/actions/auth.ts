"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/lib/auth";
import { isEmailAllowedToSignUp } from "@/lib/signup-access";
import {
  ACCOUNT_KINDS,
  loginSchema,
  signupSchema,
  type AccountKind,
} from "@/lib/validation/auth";

// Shape returned to the client forms (via useActionState). `undefined` = no
// error yet (initial render). On success the actions redirect, so they don't
// return a "success" state.
export type AuthFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: {
        name?: string;
        email?: string;
        accountKind?: string;
        orgName?: string;
        countryOfOrigin?: string;
      };
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
      // Not /dashboard: a counselor signing in belongs on their caseload, and
      // /start is the one place that decides which.
      redirectTo: "/start",
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
  const orgName = String(formData.get("orgName") ?? "");

  // An unrecognised value becomes STUDENT rather than an error. The field is a
  // radio on a form anyone can post to, and the safe failure is the account
  // that holds only its own data — not a 400 that tells someone their tampering
  // was noticed, and certainly not a caseload.
  //
  // Coerced ONCE, here, so nothing downstream — including the values echoed
  // back to the form — ever carries the raw string.
  const raw = String(formData.get("accountKind") ?? "STUDENT");
  const accountKind: AccountKind = ACCOUNT_KINDS.includes(raw as AccountKind)
    ? (raw as AccountKind)
    : "STUDENT";

  const parsed = signupSchema.safeParse({
    name,
    email,
    password,
    countryOfOrigin,
    accountKind,
    orgName,
  });
  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
      // countryOfOrigin echoed back too, even though it has no fieldError of
      // its own: an unrelated failure (password too short) must not silently
      // wipe a country the user already picked. See the comment on the
      // <select> in signup-form.tsx for why simply keeping the same prop
      // value isn't enough on its own.
      values: { name, email, accountKind, orgName, countryOfOrigin },
    };
  }

  const normalizedEmail = parsed.data.email.toLowerCase();

  // Gate registration before touching the database. On a deployed instance this
  // is what stops strangers creating accounts that spend your API credits.
  if (!isEmailAllowedToSignUp(normalizedEmail)) {
    return {
      error:
        "This address isn't on the invite list for this instance. Ask the owner to add it.",
      values: { name, email },
    };
  }

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
  const isCounselor = parsed.data.accountKind === "COUNSELOR";

  await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: normalizedEmail,
      passwordHash,
      // A counselor's own country is not a fact about anybody's application, so
      // the field is not asked for and not stored on that path.
      countryOfOrigin: isCounselor ? null : parsed.data.countryOfOrigin || null,
      // Created here, at signup, and nowhere else. There is deliberately no way
      // for an existing account to grant itself one later: a caseload holds
      // other families' children, and self-service escalation into that is not
      // a feature.
      ...(isCounselor
        ? {
            counselorAccount: {
              create: {
                orgName: parsed.data.orgName || null,
                type: "INDEPENDENT",
              },
            },
          }
        : {}),
    },
  });

  // Log the new user straight in. /start decides which of the two products
  // they land in, so this path does not need to know.
  try {
    await signIn("credentials", {
      email: normalizedEmail,
      password: parsed.data.password,
      redirectTo: "/start",
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
