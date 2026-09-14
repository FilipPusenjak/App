"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Adding a student, from the tutor's side.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE COUNSELOR'S. The counselor's version at
 * app/(counselor)/caseload/students/redeem-invite.tsx offers a scope picker,
 * because a counselor genuinely chooses how much of a student's record they
 * need. A test-prep tutor does not choose: the scope is always TEST_PREP_ONLY,
 * the narrowest in the product, and the server narrows it regardless of what is
 * posted — see the note in app/api/counselor/links/route.ts. So there is no
 * picker here, and the copy says plainly what the tutor will and will not see.
 *
 * A CODE IS SOMETHING A STUDENT HANDED OVER. There is no lookup by email or by
 * name anywhere in this product, which is what stops a tutor discovering that
 * an account exists at all. This form takes the code and nothing else.
 */
export function RedeemInvite() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "done"; message: string }
  >({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setState({ kind: "sending" });

    const response = await fetch("/api/counselor/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sent explicitly rather than relying on the default, which is FULL. The
      // server narrows it for a tutor account either way; stating it here means
      // the request says what it means.
      body: JSON.stringify({ code: code.trim(), scope: "TEST_PREP_ONLY" }),
    });
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;

    if (!response.ok) {
      setState({
        kind: "error",
        message: body?.error ?? "That did not work. Check the code and try again.",
      });
      return;
    }

    setCode("");
    setState({
      kind: "done",
      message:
        body?.message ??
        "Added, and waiting on a parent or guardian. You will see nothing about this student until they agree.",
    });
    // The roster is a server component, so it needs a refresh to show the
    // pending row rather than the stale list this page was rendered with.
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="code" className="text-xs font-medium text-zinc-500">
            Invite code
          </label>
          <input
            id="code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="From the student"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-white/20 dark:bg-black/20 dark:focus:ring-white/10"
          />
        </div>
        <button
          type="submit"
          disabled={state.kind === "sending" || !code.trim()}
          className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          {state.kind === "sending" ? "Adding…" : "Add student"}
        </button>
      </div>

      {state.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
      {state.kind === "done" && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
