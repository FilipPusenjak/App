import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { findReadableLink, logCounselorRead } from "@/lib/counselor/access";
import { describeBasis } from "@/lib/counselor/caseload";
import { loadRecommendationsForPrep } from "@/lib/counselor/recommendations";
import {
  SCOPE_MEANINGS,
  TRIAGE_LABELS,
  sessionPrepNarrativeSchema,
  type LinkScope,
  type TriageKind,
} from "@/lib/validation/counselor";
import { GeneratePrepButton } from "./generate-prep-button";
import { PrepBody } from "./prep-body";

/**
 * One student, opened deliberately from the attention list.
 *
 * NOT the student's own dashboard with a different header. This page answers
 * "what do I say to this person", so it leads with why they surfaced and what
 * to raise, and it carries no readiness score, no trend chart and no
 * comparison — a counselor allocating an hour does not need a number, and one
 * here would invite exactly the ranking this product refuses to compute.
 *
 * Only ONE student's data is on screen. There is no switcher and no adjacent
 * caseload, because a surface where one student is visible while working on
 * another's is a confidentiality failure waiting for a screenshot.
 */
export default async function StudentPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;

  // Resolved, not trusted. A link belonging to another counselor or one whose
  // consent has lapsed simply is not found.
  const link = await findReadableLink(linkId);
  if (!link) notFound();

  const [profile, signals, preps] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { id: link.studentProfileId },
      select: {
        studentName: true,
        gradeLevel: true,
        graduationYear: true,
        intendedMajor: true,
        careerGoal: true,
        updatedAt: true,
      },
    }),
    prisma.triageSignal.findMany({
      where: { caseloadLinkId: link.id, resolvedAt: null },
      orderBy: [{ severity: "desc" }, { computedAt: "asc" }],
    }),
    prisma.sessionPrep.findMany({
      where: { caseloadLinkId: link.id },
      orderBy: { generatedAt: "desc" },
      take: 5,
    }),
  ]);

  await logCounselorRead({ link, surface: "student.detail" });

  const latest = preps[0];
  const narrative = latest?.narrative
    ? sessionPrepNarrativeSchema.safeParse(latest.narrative)
    : null;

  // What the counselor already decided about this prep's options, so the page
  // shows a decision rather than asking for one that was already made.
  const recommendations = latest
    ? await loadRecommendationsForPrep(latest.id)
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/caseload"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← This week
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.studentName ?? "Unnamed student"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {profile.gradeLevel ?? "Grade not set"}
            {profile.graduationYear && ` · leaves ${profile.graduationYear}`}
            {profile.intendedMajor && ` · ${profile.intendedMajor}`}
          </p>
          {link.scope !== "FULL" && (
            <p className="mt-2 max-w-xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Your access is limited to{" "}
              {SCOPE_MEANINGS[link.scope as LinkScope].toLowerCase()}. Anything
              absent below is a permission, not a fact about this student.
            </p>
          )}
        </div>
        <GeneratePrepButton linkId={link.id} hasPrep={Boolean(latest)} />
      </div>

      {/* ── Why they surfaced ────────────────────────────────────────────── */}
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Why they surfaced</h2>
        {signals.length === 0 ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Nothing open. Signals are recomputed nightly.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {signals.map((s) => (
              <li key={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {TRIAGE_LABELS[s.kind as TriageKind] ?? s.kind}
                  </span>
                  <span className="text-xs text-zinc-500">
                    severity {s.severity}/5 · since{" "}
                    {s.computedAt.toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                {/* Inspectable, not hidden. The counselor is about to repeat
                    some of this and has to be able to check it first. */}
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
                  {describeBasis((s.basis ?? {}) as Record<string, unknown>).map(
                    (pair) => (
                      <div key={pair.key} className="flex gap-1">
                        <dt className="text-zinc-400">{pair.key}:</dt>
                        <dd className="font-medium text-zinc-600 dark:text-zinc-400">
                          {pair.value}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The prep ─────────────────────────────────────────────────────── */}
      {latest?.error && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">
            Last attempt failed
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {latest.error}
          </p>
        </section>
      )}

      {narrative?.success && latest && (
        <PrepBody
          prepId={latest.id}
          generatedAt={latest.generatedAt}
          outcome={latest.outcome}
          counselorNotes={latest.counselorNotes}
          narrative={narrative.data}
          recommendations={recommendations}
        />
      )}

      {!latest && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">No prep yet</h2>
          <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Draft prep when you are about to meet them. It is generated per
            student on demand rather than for the whole caseload, so it costs
            nothing to leave a quiet student alone.
          </p>
        </section>
      )}

      {preps.length > 1 && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">Earlier sessions</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {preps.slice(1).map((p) => (
              <li key={p.id} className="flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-400">
                <span>
                  {p.generatedAt.toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="text-zinc-400">{p.outcome.toLowerCase()}</span>
                {p.counselorNotes && (
                  <span className="min-w-0 flex-1 truncate">
                    {p.counselorNotes}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
