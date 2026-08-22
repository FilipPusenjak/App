import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readStudentThroughTutorLink, readTargetSchools } from "@/lib/testprep/access";
import { deriveForStudent } from "@/lib/testprep/derive";
import { targetStatus } from "@/lib/testprep/target";
import { compositeAsSchoolSeesIt } from "@/lib/testprep/composite";
import { retakeGuidance } from "@/lib/testprep/allocation";
import { handoffMessage, isEngagementComplete } from "@/lib/testprep/stopping";
import { STOPPING_LABELS, type StoppingKind } from "@/lib/validation/testprep";
import { AcknowledgeStopping } from "./acknowledge";

/**
 * One student, and the two questions this product exists to answer: what are we
 * aiming at, and are we done.
 *
 * The stopping card is FIRST when a signal has fired. Not in a sidebar, not
 * below the score chart, not behind a disclosure — first, before the numbers
 * that make continuing feel productive. A tutor scrolling past it should have
 * to work at it.
 */
export default async function TutorStudentPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;

  const read = await readStudentThroughTutorLink({
    linkId,
    surface: "tutor.student",
  });
  if (!read) notFound();
  const { link, profile } = read;

  // One test for now — the one this student has attempts for, or the first
  // configured. A student sitting both the SAT and the ACT is a real case and a
  // later iteration; guessing at it now would mean rendering two targets with
  // no way to say which one the family should care about.
  const attempt = await prisma.scoreAttempt.findFirst({
    where: { studentUserId: link.studentUserId },
    orderBy: { takenAt: "desc" },
    select: { testTypeId: true },
  });
  const testType = attempt
    ? await prisma.testType.findUnique({
        where: { id: attempt.testTypeId },
        select: { id: true, code: true, name: true },
      })
    : await prisma.testType.findFirst({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      });

  const [targets, derived, signals, artifacts] = await Promise.all([
    readTargetSchools(link),
    testType
      ? deriveForStudent({
          studentUserId: link.studentUserId,
          profileId: link.studentProfileId,
          testTypeId: testType.id,
        })
      : null,
    testType
      ? prisma.stoppingSignal.findMany({
          where: {
            studentUserId: link.studentUserId,
            testTypeId: testType.id,
            resolvedAt: null,
          },
          orderBy: { firedAt: "asc" },
        })
      : [],
    prisma.progressArtifact.findMany({
      where: { caseloadLinkId: link.id },
      orderBy: { periodEnd: "desc" },
      take: 3,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        sharedWithGuardianAt: true,
        error: true,
      },
    }),
  ]);

  const attempts = testType
    ? await prisma.scoreAttempt.findMany({
        where: { studentUserId: link.studentUserId, testTypeId: testType.id },
        orderBy: { takenAt: "desc" },
        take: 10,
        select: {
          id: true,
          kind: true,
          takenAt: true,
          composite: true,
          isVerified: true,
        },
      })
    : [];

  const bindingSuperscores = derived?.target.bindingSchoolId
    ? ((
        await prisma.schoolTestPolicy.findFirst({
          where: {
            schoolId: derived.target.bindingSchoolId,
            testTypeId: testType!.id,
          },
          orderBy: { effectiveCycle: "desc" },
          select: { superscores: true },
        })
      )?.superscores ?? false)
    : false;

  // Read from the FULL history rather than the ten sittings shown below. A
  // superscoring school reads every sitting a student has ever sent it, so a
  // composite computed from a truncated display list would be the wrong number
  // — and it would be the number in the band comparison.
  const seen = derived
    ? compositeAsSchoolSeesIt(
        (
          await prisma.scoreAttempt.findMany({
            where: { studentUserId: link.studentUserId, testTypeId: testType!.id },
            select: { sectionScores: true, composite: true },
          })
        ).map((a) => ({
          sectionScores: (a.sectionScores ?? {}) as Record<string, number>,
          composite: a.composite,
        })),
        derived.rule,
        derived.schema,
        bindingSuperscores,
      )
    : null;

  const status = derived ? targetStatus(seen, derived.target) : "GAP_REMAINS";
  const retake = retakeGuidance({
    allocations: derived?.allocations ?? [],
    bindingSuperscores,
    bindingSchoolName: derived?.target.bindingSchoolName ?? null,
  });
  const unacknowledged = signals.filter((s) => !s.acknowledgedByTutorAt);

  return (
    <div className="space-y-6">
      <Link
        href="/students-testprep"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← Students
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.studentName ?? "Unnamed student"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {profile.gradeLevel ?? "Grade not set"}
          {profile.graduationYear && ` · leaves ${profile.graduationYear}`}
          {testType && ` · ${testType.code}`}
        </p>
        <p className="mt-2 max-w-xl rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          You can see this student&rsquo;s test scores and target schools. You
          cannot see their grades, activities, essays or anything else — that is
          what they agreed to.
        </p>
      </div>

      {/* ── The stopping card, FIRST ──────────────────────────────────────── */}
      {signals.length > 0 && derived && (
        <section className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-5 dark:border-emerald-700 dark:bg-emerald-950/30">
          <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
            {unacknowledged.length > 0
              ? "This needs your attention before the next session"
              : "Target reached"}
          </h2>
          <ul className="mt-3 space-y-4">
            {signals.map((s) => {
              const basis = (s.basis ?? {}) as Record<string, unknown>;
              return (
                <li key={s.id}>
                  <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                    {STOPPING_LABELS[s.kind as StoppingKind] ?? s.kind}
                  </p>
                  <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                    {typeof basis.summary === "string" ? basis.summary : ""}
                  </p>
                  {/* INSPECTABLE, not hidden. A tutor is about to tell a
                      family to stop paying them; they will not do that on a
                      system's say-so and should not have to. */}
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                    {Object.entries(basis)
                      .filter(([k]) => k !== "summary" && k !== "signal")
                      .map(([k, v]) => (
                        <div key={k} className="flex gap-1">
                          <dt className="opacity-70">{k}:</dt>
                          <dd className="font-medium">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {!s.acknowledgedByTutorAt && <AcknowledgeStopping signalId={s.id} />}
                </li>
              );
            })}
          </ul>

          {isEngagementComplete(
            signals.map((s) => ({ kind: s.kind as StoppingKind })),
          ) && (
            /* Information, never an upsell. It happens to point at the
               counselor edition and would be equally true if that did not
               exist. */
            <p className="mt-4 border-t border-emerald-300 pt-3 text-sm text-emerald-800 dark:border-emerald-800 dark:text-emerald-200">
              {handoffMessage(derived.target)}
            </p>
          )}
        </section>
      )}

      {/* ── The target ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">What we are aiming at</h2>
        {!derived || derived.target.bindingComposite === null ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            No school on this student&rsquo;s list sets a score bar we hold data
            for. That is a real answer — it means a score cannot be the thing
            deciding these applications.
          </p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {derived.target.bandLow}–{derived.target.bandHigh}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Set by <strong>{derived.target.bindingSchoolName}</strong>, the
              highest bar on this list. Currently{" "}
              {seen !== null ? (
                <strong className="tabular-nums">{seen}</strong>
              ) : (
                "no score recorded"
              )}
              {" — "}
              {status === "CLEARED"
                ? "clear of the band"
                : status === "IN_BAND"
                  ? "inside the band"
                  : "below the band"}
              .
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              The band is the middle 50% of admitted students at{" "}
              {derived.target.bindingSchoolName}, not a cutoff.
              {bindingSuperscores
                ? " This school superscores, so it reads the best section from each sitting."
                : " This school does not superscore, so it reads the best single sitting."}
            </p>
          </>
        )}

        {derived && derived.target.contributions.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-zinc-500">
              Why each school does or does not set the target
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {derived.target.contributions.map((c) => (
                <li key={c.schoolId}>{c.reason}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── Where the room is ─────────────────────────────────────────────── */}
      {derived && derived.allocations.length > 0 && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">Where the room is</h2>
          <ul className="mt-3 space-y-2">
            {derived.allocations.map((a) => (
              <li key={a.sectionName} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{a.sectionName}</span>
                <span className="text-zinc-500">
                  {a.currentScore ?? "not sat"}
                  {a.headroom > 0 ? ` · ${a.headroom} points of room` : " · at the maximum"}
                </span>
                {a.recommendedFocus && (
                  <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
                    most room
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* WHERE THE ROOM IS is not the same claim as WHAT TO AIM A RETAKE AT.
              At a school that does not superscore they come apart, and this is
              the sentence that keeps them apart on screen. */}
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {retake.message}
          </p>

          {/* The label the brief requires, in the UI rather than only in a
              comment. It is a fact about a scale, not about this student. */}
          <p className="mt-3 border-t border-black/10 pt-3 text-xs text-zinc-500 dark:border-white/10">
            This is a heuristic about where headroom exists, not a measurement of
            how fast this student learns. It carries no timeline, and nothing here
            predicts a future score.
          </p>
        </section>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Sittings</h2>
        {attempts.length === 0 ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-400">
                <span className="tabular-nums">
                  {a.takenAt.toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="text-zinc-400">{a.kind.toLowerCase()}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {a.composite ?? "—"}
                </span>
                {!a.isVerified && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    not verified against a score report
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Target list ───────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Target schools</h2>
        {targets.length === 0 ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            None listed. Without a list there is no target to derive.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {targets.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        )}
      </section>

      {artifacts.length > 0 && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">Updates sent home</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {artifacts.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3">
                <span>
                  {a.periodStart.toLocaleDateString("en-US", { month: "short" })} –{" "}
                  {a.periodEnd.toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="text-zinc-400">
                  {a.error
                    ? "failed"
                    : a.sharedWithGuardianAt
                      ? "shared"
                      : "drafted, not sent"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
