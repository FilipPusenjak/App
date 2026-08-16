import Link from "next/link";
import { peekResetToken } from "@/lib/password-reset-store";
import { resetTokenMessage } from "@/lib/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * The page a reset link opens.
 *
 * The token is checked before the form renders, so someone holding a dead link
 * is told so immediately rather than after choosing and typing a new password
 * twice. This is a READ — it never spends the token. Rendering the page must
 * not consume it, or a refresh would burn the link.
 *
 * Deliberately not redirecting a signed-in user away: changing your password
 * while logged in on another device is a normal thing to be doing, and it is
 * exactly what someone does when they think an account is compromised.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const state = token ? await peekResetToken(token) : "unknown";
  const problem = resetTokenMessage(state);

  if (problem) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold">Reset link</h1>
        <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {problem}
        </p>
        <p className="text-sm text-zinc-500">
          <Link
            href="/forgot-password"
            className="font-medium text-zinc-900 underline dark:text-zinc-100"
          >
            How to get a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Choose a new password</h1>
      <p className="mb-6 text-sm text-zinc-500">
        At least 8 characters. You&apos;ll be signed in once it&apos;s saved.
      </p>
      <ResetPasswordForm token={token!} />
    </div>
  );
}
