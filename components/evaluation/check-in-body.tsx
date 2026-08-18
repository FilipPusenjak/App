// A Check-In, rendered.
//
// Short on purpose, and the shortness is the feature. A check-in answers one
// question — what moved in the last fortnight, and what is the single next
// thing — and padding it out to look like a Deep Review would sell a student
// the feeling of a strategy review every two weeks. That is the thrash the
// 21-day floor on Deep Reviews exists to prevent; reproducing it here in a
// cheaper form would defeat it.
//
// It also never presents itself as "where you stand". Two weeks is not the
// whole picture, and the dashboard deliberately shows no standing for one.
import Link from "next/link";
import type { CheckInNarrative } from "@/lib/validation/tiers";
import { Card, Pill } from "./detail-ui";

export function CheckInBody({ narrative }: { narrative: CheckInNarrative }) {
  return (
    <>
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={MOVEMENT_STYLES[narrative.movement.direction]}>
            {MOVEMENT_LABELS[narrative.movement.direction] ??
              narrative.movement.direction}
          </Pill>
          <span className="text-xs text-zinc-500">over the last fortnight</span>
        </div>
        <p className="mt-3 text-lg font-medium leading-snug">
          {narrative.headline}
        </p>
        {narrative.movement.driver && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {narrative.movement.driver}
          </p>
        )}
      </section>

      <Card
        title="Do this next"
        subtitle="One thing, not a list. A fortnight fits one real step."
      >
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.actionThisFortnight}
        </p>
        {/* The rung ladder, shown as the step it actually is. Naming both ends
            is what makes it checkable — "go deeper" is not something anyone can
            act on or tell they have done. */}
        {narrative.nextRung && (
          <div className="mt-4 rounded-lg border border-black/10 p-3 dark:border-white/15">
            <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <Pill>{narrative.nextRung.currentRung}</Pill>
              <span aria-hidden>→</span>
              <Pill>{narrative.nextRung.targetRung}</Pill>
            </p>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              {narrative.nextRung.concreteStep}
            </p>
          </div>
        )}
      </Card>

      {narrative.commitmentPrompts.length > 0 && (
        <Card
          title="On what you took on"
          subtitle="Asked rather than assumed — the app does not know whether you did these, and guessing would put a false record in your history."
        >
          <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {narrative.commitmentPrompts.map((p) => (
              <li key={p.commitmentId}>{p.question}</li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-zinc-400">
        A check-in is a fortnight&apos;s change, not a full assessment. For
        where you stand overall, see your{" "}
        <Link href="/dashboard" className="underline underline-offset-2">
          dashboard
        </Link>{" "}
        or your most recent Deep Review.
      </p>
    </>
  );
}

/**
 * Movement over a fortnight.
 *
 * "DOWN" is styled neutrally, not red. Over two weeks it usually means a
 * commitment slipped or an activity paused — normal life, not a crisis — and a
 * red badge every time a teenager had a busy fortnight teaches them to dread
 * opening the app.
 */
const MOVEMENT_STYLES: Record<string, string> = {
  UP: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  FLAT: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  DOWN: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

const MOVEMENT_LABELS: Record<string, string> = {
  UP: "something moved forward",
  FLAT: "no real change",
  DOWN: "some ground given back",
};
