"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// From the validation module, NEVER from lib/developments — that one imports
// Prisma, and a client component pulling it drags the Postgres driver into the
// browser bundle and breaks the build for every page.
import { DEVELOPMENT_MAX } from "@/lib/validation/developments";

/**
 * Where a student says what happened.
 *
 * Two placements, one component: a general box on the dashboard, and a reply
 * box under a commitment the check-in asked about. The second is the reason
 * this exists — the check-in already ends with "did you speak to the coach, and
 * what did they say?", and until now there was nowhere to answer.
 *
 * Deliberately small. A large empty textarea invites a diary, and this is an
 * admissions tool with tone rules rather than somewhere to process a bad week.
 */
export function DevelopmentComposer({
  commitmentId,
  placeholder = "Anything happen worth noting? A conversation, a result, a change of plan.",
  label,
}: {
  commitmentId?: string;
  placeholder?: string;
  label?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const tooLong = body.length > DEVELOPMENT_MAX;
  const canSave = body.trim().length >= 3 && !tooLong && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/developments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), commitmentId: commitmentId ?? null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "That didn't save.");
        return;
      }
      setBody("");
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      {label && (
        <label htmlFor={`dev-${commitmentId ?? "general"}`} className="text-sm font-medium">
          {label}
        </label>
      )}
      <textarea
        id={`dev-${commitmentId ?? "general"}`}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved(false);
        }}
        rows={3}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
      />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {/* The count appears only as it starts to matter, so an empty box does
            not present itself as a form with a quota to fill. */}
        {body.length > DEVELOPMENT_MAX - 150 && (
          <span className={`text-xs ${tooLong ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
            {body.length}/{DEVELOPMENT_MAX}
          </span>
        )}
        {saved && (
          <span className="text-xs text-zinc-500">
            Saved — your next check-in will read this.
          </span>
        )}
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    </div>
  );
}

/** One recorded development, with a way to take it back. */
export function DevelopmentItem({
  id,
  body,
  createdAt,
  read,
}: {
  id: string;
  body: string;
  createdAt: string;
  read: boolean;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/developments/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <li className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <p className="text-sm">{body}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <span className="text-xs text-zinc-500">{createdAt}</span>
        {/* Whether it has been used yet. A student who wrote something and then
            saw no mention of it needs to know it is queued, not ignored. */}
        <span className="text-xs text-zinc-400">
          {read ? "read by a check-in" : "waiting for your next check-in"}
        </span>
        <button
          type="button"
          onClick={remove}
          disabled={removing}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}
