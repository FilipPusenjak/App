import { redirect } from "next/navigation";
import { getStudentsOverview } from "@/app/actions/students";
import { switchStudentAction } from "@/app/actions/students";
import { studentLabel } from "@/lib/students";
import { prisma } from "@/lib/db";
import { DeleteStudentForm, RenameStudentForm } from "./students-forms";

export const metadata = { title: "Students" };

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/10 bg-surface p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function StudentsPage() {
  const { profiles, activeId } = await getStudentsOverview();

  // Closed to new signups: this page has nothing to offer an account that
  // never had more than one profile, and nothing links here for one any more
  // (the layout hides the nav tab the same way — see isMultiStudent). Gating
  // the route too means a solo account can't land here even by URL and find a
  // students page with no way to add a second one.
  if (profiles.length <= 1) redirect("/dashboard");

  // Counts per student, so the list says what is actually in each record
  // rather than just naming them. Scoped to profiles already proven to belong
  // to this account.
  const counts = await prisma.profile.findMany({
    where: { id: { in: profiles.map((p) => p.id) } },
    select: {
      id: true,
      _count: {
        select: {
          resumeItems: true,
          targetSchools: true,
          evaluations: true,
        },
      },
    },
  });
  const countById = new Map(counts.map((c) => [c.id, c._count]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Students</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Profiles from before this closed to new signups. Everything else in
          the app shows the student you have selected here.
        </p>
      </div>

      <Card
        title="Your students"
        subtitle="Each keeps a separate profile, target list, plans and evaluation history."
      >
        <ul className="space-y-3">
          {profiles.map((profile) => {
            const isActive = profile.id === activeId;
            const count = countById.get(profile.id);
            const name = studentLabel(profile);

            return (
              <li
                key={profile.id}
                className={`rounded-lg border p-4 ${
                  isActive
                    ? "border-zinc-900/30 bg-zinc-50 dark:border-white/30 dark:bg-white/10"
                    : "border-black/10 dark:border-white/15"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium">
                      {name}
                      {isActive && (
                        <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
                          selected
                        </span>
                      )}
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {profile.gradeLevel ?? "No grade level set"}
                      {profile.intendedMajor ? ` · ${profile.intendedMajor}` : ""}
                      {count
                        ? ` · ${count.resumeItems} item${count.resumeItems === 1 ? "" : "s"}, ${count.targetSchools} target${count.targetSchools === 1 ? "" : "s"}, ${count.evaluations} evaluation${count.evaluations === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!isActive && (
                      <form action={switchStudentAction}>
                        <input
                          type="hidden"
                          name="profileId"
                          value={profile.id}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-black/15 px-2 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Select
                        </button>
                      </form>
                    )}
                    <DeleteStudentForm
                      profileId={profile.id}
                      name={name}
                      canDelete={profiles.length > 1}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <RenameStudentForm
                    profileId={profile.id}
                    currentName={profile.studentName ?? ""}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
