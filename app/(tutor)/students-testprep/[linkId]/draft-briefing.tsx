"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressNarrative } from "@/lib/validation/testprep";

/**
 * Drafting a progress briefing.
 *
 * THE ONE PLACE THIS PRODUCT CALLS A MODEL, and the button says so before it is
 * pressed rather than after. Everything else on this screen — the target, the
 * allocation, the stopping signals — was computed by code a tutor could audit.
 * A tutor should know which of the two they are looking at.
 *
 * DRAFTED, NEVER SENT. There is no channel from this app to a student's family
 * and this button does not open one. It returns a document to the tutor, on
 * screen, to copy or discard. The wording never says "send", and the marking of
 * one as forwarded is bookkeeping about something the tutor did in their own
 * email — see markBriefingForwardedAction.
 *
 * WHY THE FAILURES ARE SHOWN IN FULL. The route discards a briefing that omits a
 * fired stopping notice, or that predicts a future score, and it charges for the
 * run either way. A tutor who sees "something went wrong" learns nothing; a
 * tutor who reads "the draft left out the stopping notice and was discarded"
 * learns that the check exists and is on their side. So the route's own message
 * is rendered rather than replaced.
 */
type Draft = { id: string; narrative: ProgressNarrative };

export function DraftBriefing({
  linkId,
  testTypeId,
  hasFiredSignal,
}: {
  linkId: string;
  testTypeId: string;
  hasFiredSignal: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "drafting" }
    | { kind: "error"; message: string }
    | { kind: "done"; draft: Draft }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function draft() {
    setState({ kind: "drafting" });
    const response = await fetch("/api/tutor/artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId, testTypeId }),
    }).catch(() => null);

    if (!response) {
      setState({
        kind: "error",
        message: "The request did not reach the server. Try again.",
      });
      return;
    }

    const body = (await response.json().catch(() => null)) as
      | { id?: string; error?: string; narrative?: ProgressNarrative }
      | null;

    if (!response.ok || !body?.narrative || !body.id) {
      setState({
        kind: "error",
        message: body?.error ?? "The draft did not come back. Try again.",
      });
      // A discarded run is still a row on this student, with its cost recorded.
      // Refreshed so the list below shows it rather than hiding the charge.
      router.refresh();
      return;
    }

    setState({ kind: "done", draft: { id: body.id, narrative: body.narrative } });
    router.refresh();
  }

  if (state.kind === "done") {
    return <DraftedBriefing draft={state.draft} copied={copied} setCopied={setCopied} />;
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={draft}
        disabled={state.kind === "drafting"}
        className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {state.kind === "drafting" ? "Drafting…" : "Draft a briefing"}
      </button>
      <p className="mt-2 max-w-xl text-xs text-zinc-500">
        Covers the last 30 days. This is the one part of this product written by
        a model — everything else on this page was computed. It is drafted for
        you and goes nowhere until you send it yourself.
        {hasFiredSignal &&
          " A stopping signal has fired, so the draft has to carry it or it will be discarded."}
      </p>
      {state.kind === "error" && (
        <p className="mt-2 max-w-xl text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </div>
  );
}

function DraftedBriefing({
  draft,
  copied,
  setCopied,
}: {
  draft: Draft;
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const n = draft.narrative;
  const plain = [
    n.headline,
    "",
    n.summary,
    "",
    `Focus: ${n.focusThisPeriod}`,
    ...(n.stoppingNotice ? ["", n.stoppingNotice] : []),
    "",
    n.whatThisDoesNotTellYou,
  ].join("\n");

  return (
    <div className="mt-4 rounded-md border border-black/10 bg-zinc-50 p-4 dark:border-white/15 dark:bg-black/20">
      <p className="text-base font-medium">{n.headline}</p>
      <p className="mt-2 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
        {n.summary}
      </p>
      <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
        <span className="text-zinc-500">Focus:</span> {n.focusThisPeriod}
      </p>

      {/* The stopping notice is set apart and kept ABOVE the caveats rather than
          folded into the summary, for the same reason the stopping card is first
          on this page: it is the finding a busy reader most needs not to miss. */}
      {n.stoppingNotice && (
        <p className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
          {n.stoppingNotice}
        </p>
      )}

      <p className="mt-3 border-t border-black/10 pt-3 text-xs text-zinc-500 dark:border-white/10">
        {n.whatThisDoesNotTellYou}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(plain).catch(() => {});
            setCopied(true);
          }}
          className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy as text"}
        </button>
        <span className="text-xs text-zinc-500">
          Yours to send, edit around, or ignore. Nothing has been sent.
        </span>
      </div>
    </div>
  );
}
