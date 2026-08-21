"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LINK_SCOPES, SCOPE_MEANINGS, type LinkScope } from "@/lib/validation/counselor";

/**
 * Add a student, by redeeming a code they gave you.
 *
 * Note what this form does NOT have: a field for a student's name or email
 * address. A counselor who could type an address to invite a student could also
 * type one to find out whether it belongs to an account, and this product holds
 * records about minors. So the student issues the code and hands it over, and
 * this is the only door.
 *
 * The scope is chosen HERE, at the moment of asking, rather than being
 * negotiated later. A tutor who needs grades and not an activity portfolio says
 * so up front, the student sees exactly what was requested before agreeing, and
 * the choice is enforced in the Prisma SELECT rather than in a component.
 */
export function RedeemInvite() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [scope, setScope] = useState<LinkScope>("FULL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/counselor/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, scope }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "That code could not be redeemed.");
        return;
      }
      setCode("");
      setDone(data.message ?? "Added.");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="min-w-[14rem] flex-1 text-xs text-zinc-500">
          Invite code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCDE-FGHJK"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 font-mono text-sm tracking-widest text-foreground uppercase dark:border-white/15 dark:bg-white/5"
          />
        </label>
        <label className="min-w-[14rem] flex-1 text-xs text-zinc-500">
          What you need to see
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as LinkScope)}
            className="mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-foreground dark:border-white/15 dark:bg-white/5"
          >
            {LINK_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_MEANINGS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy || code.trim().length === 0}
        className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy ? "Adding…" : "Add student"}
      </button>
      {/* Said plainly, because a counselor who expects to see a student
          immediately will otherwise read the empty list as a bug. */}
      <p className="text-xs text-zinc-500">
        Ask only for what you need. You will see nothing at all — not even a name
        — until a parent or guardian has agreed as well.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {done && <p className="text-sm text-zinc-600 dark:text-zinc-400">{done}</p>}
    </form>
  );
}
