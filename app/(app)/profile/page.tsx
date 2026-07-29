import Link from "next/link";
import { getCurrentDbUser } from "@/lib/session";
import { getProfileWithRelations } from "@/lib/ownership";
import {
  RESUME_ITEM_TYPE_LABELS,
  TEST_SCORE_KIND_LABELS,
  type ResumeItemType,
  type TestScoreKind,
} from "@/lib/validation/enums";
import { countryName } from "@/lib/data/countries";
import {
  deleteResumeItemAction,
  deleteTestScoreAction,
} from "@/app/actions/profile";
import { SubmitButton } from "@/components/ui/submit-button";
import { ProfileForm } from "./profile-form";
import { AddTestScoreForm } from "./add-test-score-form";

function monthYear(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      {children}
    </section>
  );
}

export default async function ProfilePage() {
  // getCurrentDbUser already carries countryOfOrigin and is deduplicated per
  // request, so this needs no separate user query.
  const [profile, user] = await Promise.all([
    getProfileWithRelations(),
    getCurrentDbUser(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everything here is private to your account.
        </p>
      </div>

      {/* Academic profile */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Academic profile</h2>
        <ProfileForm
          values={{
            gradeLevel: profile.gradeLevel,
            schoolName: profile.schoolName,
            schoolContext: profile.schoolContext,
            curriculum: profile.curriculum,
            gpa: profile.gpa,
            gpaScale: profile.gpaScale,
            intendedMajor: profile.intendedMajor,
            careerGoal: profile.careerGoal,
            countryOfOrigin: user?.countryOfOrigin ?? null,
          }}
        />
        {user?.countryOfOrigin && (
          <p className="mt-3 text-xs text-zinc-400">
            Country of origin: {countryName(user?.countryOfOrigin)}
          </p>
        )}
      </Card>

      {/* Test scores */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Test scores</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Include predicted grades too — subject-level depth matters for UK
          courses.
        </p>

        {profile.testScores.length > 0 ? (
          <ul className="mb-6 divide-y divide-black/5 dark:divide-white/10">
            {profile.testScores.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{s.label}</span>{" "}
                  <span className="text-sm text-zinc-500">
                    — {s.score}
                    {s.maxScore ? ` / ${s.maxScore}` : ""}
                  </span>
                  <div className="text-xs text-zinc-400">
                    {TEST_SCORE_KIND_LABELS[s.kind as TestScoreKind] ?? s.kind}
                    {s.predicted ? " · predicted" : ""}
                    {s.takenOn ? ` · ${monthYear(s.takenOn)}` : ""}
                  </div>
                </div>
                <form action={deleteTestScoreAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton variant="danger" pendingText="…">
                    Delete
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-sm text-zinc-400">No test scores yet.</p>
        )}

        <div className="rounded-lg border border-dashed border-black/15 p-4 dark:border-white/20">
          <h3 className="mb-3 text-sm font-medium">Add a score</h3>
          <AddTestScoreForm />
        </div>
      </Card>

      {/* Resume items */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Resume items</h2>
            <p className="text-sm text-zinc-500">
              Activities, awards, research, work, projects, and more.
            </p>
          </div>
          <Link
            href="/profile/items/new"
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add item
          </Link>
        </div>

        {profile.resumeItems.length > 0 ? (
          <ul className="space-y-3">
            {profile.resumeItems.map((item) => {
              const start = monthYear(item.startDate);
              const end = monthYear(item.endDate);
              const range = start
                ? `${start} – ${end ?? "present"}`
                : end
                  ? `until ${end}`
                  : null;
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                        {RESUME_ITEM_TYPE_LABELS[item.type as ResumeItemType] ??
                          item.type}
                      </span>
                      <h3 className="mt-1 font-medium">{item.title}</h3>
                      <p className="text-sm text-zinc-500">
                        {[item.org, range, item.hoursPerWeek ? `${item.hoursPerWeek} hrs/wk` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {item.description && (
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                          {item.description}
                        </p>
                      )}
                      {item.evidenceNotes && (
                        <p className="mt-1 text-xs text-zinc-400">
                          Evidence: {item.evidenceNotes}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/profile/items/${item.id}`}
                        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Edit
                      </Link>
                      <form action={deleteResumeItemAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton variant="danger" pendingText="…">
                          Delete
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">
            No resume items yet. Click “Add item” to start building your profile.
          </p>
        )}
      </Card>
    </div>
  );
}
