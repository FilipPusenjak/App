"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import {
  RUN_LABELS,
  resultHref,
  runningLabel,
  type InFlightRun,
  type RunKind,
} from "@/lib/runs/in-flight";

/**
 * The one place that knows a run is happening.
 *
 * It lives in the (app) layout, ABOVE the router's children, which is the
 * whole point: a client component mounted in a layout survives navigation
 * between the pages inside it. The state used to sit in the button that
 * started the run, so walking from Evaluations to Profile unmounted the only
 * thing that knew — and the student was left looking at an app that showed no
 * sign of the minute-long, credit-costing thing they had just started.
 *
 * It owns the fetch as well as the label. That is what stops the other half of
 * the same bug: the old code called router.push() from a component that might
 * no longer be mounted, so a student who wandered off to edit their profile
 * got yanked onto an evaluation page mid-sentence a minute later. Here we know
 * where they launched from and whether they are still there.
 */

type Outcome = { kind: RunKind; id: string };
type Failure = { message: string; offerUpgrade: boolean };

type RunProgress = {
  /** The run happening now, from our own fetch or from a pending row. */
  run: InFlightRun | null;
  /** True while anything is running — every run button reads this. */
  busy: boolean;
  failure: Failure | null;
  /**
   * Start a run. Resolves when it settles; the banner is driven from here, so
   * callers do not need to hold any state of their own.
   */
  start: (input: {
    kind: RunKind;
    url: string;
    body?: unknown;
  }) => Promise<void>;
};

const Ctx = createContext<RunProgress | null>(null);

export function useRunProgress(): RunProgress {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useRunProgress must be used inside RunProgressProvider");
  }
  return ctx;
}

/** How often to re-ask the server about a run we did not start ourselves. */
const POLL_MS = 5000;

export function RunProgressProvider({
  serverRun,
  children,
}: {
  /** A pending row found at render time — see lib/runs/pending.ts. */
  serverRun: InFlightRun | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [localRun, setLocalRun] = useState<InFlightRun | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Where the student was standing when they pressed the button. */
  const launchedFrom = useRef<string | null>(null);
  /**
   * Where they are standing NOW.
   *
   * A ref rather than the `pathname` variable, because the only moment this
   * question gets asked is inside a fetch that was started a minute ago, and
   * that closure captured the path as it was when the button was pressed.
   * Comparing that to itself says "they never moved" every time — which is
   * precisely the yank this component exists to prevent.
   */
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);

  // Our own fetch is the better witness when we have one: it knows the moment
  // the run settles, where a pending row only stops existing on the next load.
  const run = localRun ?? serverRun;

  // A run we did NOT start — the browser was reloaded, or this is a second tab
  // — has no fetch to tell us when it ends, so ask the server on a timer. The
  // layout re-queries and serverRun goes null, which stops the interval.
  useEffect(() => {
    if (!serverRun || localRun) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [serverRun, localRun, router]);

  // Clear the "it's ready" note once they have actually gone and read it, so
  // it does not follow them around the app after it has done its job.
  //
  // Adjusted during render rather than in an effect. React documents this
  // shape for exactly this case — state that needs to change in response to
  // something that already changed — and it re-renders before committing, so
  // the stale banner is never painted. The effect version passed review and
  // then failed lint for the reason the lint rule exists: it would have shown
  // the note for one frame and then cascaded a second render to remove it.
  if (outcome && pathname === resultHref(outcome.kind, outcome.id)) {
    setOutcome(null);
  }

  const start = useCallback(
    async ({
      kind,
      url,
      body,
    }: {
      kind: RunKind;
      url: string;
      body?: unknown;
    }) => {
      setLocalRun({ kind, startedAt: Date.now() });
      setOutcome(null);
      setFailure(null);
      launchedFrom.current = currentPath.current;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const data = (await res.json()) as { id?: string; error?: string };

        if (!res.ok) {
          setFailure({
            message: data.error ?? `The ${RUN_LABELS[kind]} could not be run.`,
            // 402 is the quota refusal — the plan does not include this run, or
            // the interval has not elapsed. Both are fixed on the billing page.
            // A 429 or a 502 has nothing there, and offering it would waste the
            // one action we give them.
            offerUpgrade: res.status === 402,
          });
          // A failed run is still recorded, so whatever list they are looking
          // at should show it.
          router.refresh();
          return;
        }

        if (!data.id) return;

        // Still standing where they launched from: take them to the result,
        // which is what pressing the button has always meant. If they walked
        // away, leave them alone and let the banner offer the link instead.
        if (launchedFrom.current === currentPath.current) {
          router.push(resultHref(kind, data.id));
        } else {
          setOutcome({ kind, id: data.id });
          router.refresh();
        }
      } catch {
        setFailure({
          message: "Could not reach the server. Is the app still running?",
          offerUpgrade: false,
        });
      } finally {
        setLocalRun(null);
      }
    },
    [router],
  );

  return (
    <Ctx.Provider value={{ run, busy: run !== null, failure, start }}>
      <RunBanner
        run={run}
        outcome={outcome}
        failure={failure}
        onDismiss={() => {
          setOutcome(null);
          setFailure(null);
        }}
      />
      {children}
    </Ctx.Provider>
  );
}

/**
 * The strip under the nav.
 *
 * Deliberately in the layout rather than at the top of each page: it has to be
 * visible from Profile and Targets and Plans, which is exactly where a student
 * goes to fill in the gaps the app just told them about while their review
 * runs.
 */
function RunBanner({
  run,
  outcome,
  failure,
  onDismiss,
}: {
  run: InFlightRun | null;
  outcome: Outcome | null;
  failure: Failure | null;
  onDismiss: () => void;
}) {
  if (!run && !outcome && !failure) return null;

  return (
    <div
      // Announced politely rather than assertively: this is a status line, and
      // it must not interrupt a screen reader mid-sentence on another page.
      role="status"
      aria-live="polite"
      className="border-b border-black/10 bg-surface dark:border-white/15"
    >
      <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-2.5 text-sm sm:px-6">
        {run ? (
          <>
            <Spinner className="h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
            <span className="text-zinc-700 dark:text-zinc-300">
              {runningLabel(run.kind)}
            </span>
            <span className="ml-auto hidden text-xs text-zinc-500 sm:inline">
              You can keep working — we&apos;ll tell you when it&apos;s done.
            </span>
          </>
        ) : outcome ? (
          <>
            <span className="text-zinc-700 dark:text-zinc-300">
              Your {RUN_LABELS[outcome.kind]} is ready.
            </span>
            <Link
              href={resultHref(outcome.kind, outcome.id)}
              className="font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              Read it
            </Link>
            <DismissButton onClick={onDismiss} />
          </>
        ) : failure ? (
          <>
            <span className="text-red-600 dark:text-red-400">
              {failure.message}
            </span>
            {failure.offerUpgrade && (
              <Link
                href="/settings/billing"
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                Upgrade or enter a code
              </Link>
            )}
            <DismissButton onClick={onDismiss} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="ml-auto shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
    >
      Dismiss
    </button>
  );
}
