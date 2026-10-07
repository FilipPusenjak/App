"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setAiConsentAction } from "@/app/actions/ai-consent";

/**
 * The question asked once, before the first AI run.
 *
 * Shown in place of running, not as a modal over it: the student pressed a
 * button expecting a review, and the honest next screen is "this is where your
 * profile is about to go" with the review one click away — not a dialog to
 * dismiss on the way to what they wanted.
 *
 * Names the company and lists what is sent, because Apple's 5.1.2(i) asks for
 * exactly that and because "an AI" tells a fifteen-year-old nothing. The list
 * must match app/privacy section 2.
 */
export function AiConsentPanel({
  onAllowed,
  onCancel,
}: {
  /** Runs what the student originally asked for, once permission is saved. */
  onAllowed: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allow = () =>
    startTransition(async () => {
      const result = await setAiConsentAction(true);
      if (!result.ok) {
        setError("Couldn't save that. Try signing in again.");
        return;
      }
      onAllowed();
    });

  return (
    <div
      role="dialog"
      aria-labelledby="ai-consent-title"
      className="w-full max-w-md space-y-3 rounded-xl border border-black/10 bg-white p-4 text-left text-sm shadow-sm sm:w-[28rem] dark:border-white/15 dark:bg-zinc-900"
    >
      <h2 id="ai-consent-title" className="font-semibold">
        Send your profile to our AI provider?
      </h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        Reviews, check-ins and projections are written by an AI model from{" "}
        <strong className="font-medium text-zinc-900 dark:text-zinc-100">
          Anthropic
        </strong>
        . To write one, CourseChart sends Anthropic:
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
        <li>your grades, test scores and school</li>
        <li>your activities and what you wrote about them</li>
        <li>your subject interests and target universities</li>
        <li>your earlier reviews</li>
      </ul>
      <p className="text-zinc-600 dark:text-zinc-400">
        Not your name, email or date of birth. Anthropic doesn&apos;t use it to
        train its models. This also lets a counselor or tutor you invite use
        AI to prepare for your sessions, which sends your name with their
        notes. You can turn this off in Settings at any time.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
      </p>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-black/15 px-4 py-2 font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={allow}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "Saving…" : "Allow and continue"}
        </button>
      </div>
    </div>
  );
}

/**
 * Wraps an action so it asks first when permission has not been given.
 *
 * The state lives here rather than in the run buttons, which deliberately hold
 * none (tests/unit/run-in-flight.test.ts) — the run belongs to the layout, and
 * this is only "was the student asked yet". `consented` is kept locally because
 * the page's prop only catches up on its next render.
 */
export function useAiConsentGate(initiallyConsented: boolean) {
  const [consented, setConsented] = useState(initiallyConsented);
  // What was pressed before being asked, so allowing runs THAT rather than
  // sending the student back to press it again.
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);

  const gate = (go: () => void) => () =>
    consented ? go() : setPendingAction(() => go);

  const panel = pendingAction ? (
    <AiConsentPanel
      onAllowed={() => {
        setConsented(true);
        setPendingAction(null);
        pendingAction();
      }}
      onCancel={() => setPendingAction(null)}
    />
  ) : null;

  return { gate, panel };
}
