import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles } from "@/lib/ownership";
import { listGrantsForStudent, listReadsForStudent } from "@/lib/counselor/access";
import { SCOPE_MEANINGS, type LinkScope } from "@/lib/validation/counselor";
import { ConsentButton, InviteControls, RevokeButton } from "./grant-controls";

/**
 * Who can see this account's students, and what they have actually looked at.
 *
 * The counselor edition is the only thing in this product that lets anyone
 * outside the account read a student's record, so it owes the student a page
 * like this one. Three things are here because the alternative is a promise
 * rather than a fact:
 *
 *   THE GRANT ITSELF, in plain terms. Not "sharing enabled" but this person,
 *   this student, this much of the record, since this date.
 *
 *   THE READ LOG. Every time a counselor opened the caseload, the student, or
 *   drafted prep. The log is the difference between "we only look when we need
 *   to" and something the student can check.
 *
 *   THE OFF SWITCH, on the same screen, with no confirmation step and no
 *   reason field. Access a student cannot end without asking someone is not
 *   access they granted.
 */
export default async function AccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [grants, profiles] = await Promise.all([
    listGrantsForStudent(),
    getOwnedProfiles(),
  ]);
  const profileName = new Map(
    profiles.map((p) => [p.id, p.studentName ?? "Unnamed student"]),
  );

  // Only for students something was actually granted on. A read log for a
  // student nobody has access to is a heading over an empty list.
  const watchedProfileIds = [...new Set(grants.map((g) => g.studentProfileId))];
  const readsByProfile = await Promise.all(
    watchedProfileIds.map(async (id) => ({
      profileId: id,
      reads: await listReadsForStudent(id, 50),
    })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Who can see this
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Nothing here is public and nothing is shared by default. A counselor
          or tutor can only read a student&rsquo;s record after both the student
          and a parent or guardian have agreed, and you can end that at any
          moment without asking them.
        </p>
      </div>

      {/* ── Inviting one ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Invite a counselor or tutor</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
            You give them a code — they cannot look you up. Nobody can request
            access to a student who did not offer it first.
          </p>
        </div>
        <ul className="space-y-3">
          {profiles.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5"
            >
              <h3 className="text-sm font-medium text-zinc-500">
                {p.studentName ?? "Your profile"}
              </h3>
              <div className="mt-3">
                <InviteControls
                  profileId={p.id}
                  liveCode={
                    p.counselorInviteExpiresAt &&
                    p.counselorInviteExpiresAt > new Date()
                      ? p.counselorInviteCode
                      : null
                  }
                  expiresAt={p.counselorInviteExpiresAt}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The grants ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Access</h2>
        {grants.length === 0 ? (
          <p className="rounded-xl border border-black/10 bg-white p-5 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
            Nobody outside this account can see anything. There is no counselor
            or tutor linked to any student here.
          </p>
        ) : (
          <ul className="space-y-3">
            {grants.map((g) => {
              const live =
                g.status === "ACTIVE" && g.studentConsentAt && g.guardianConsentAt;
              return (
                <li
                  key={g.id}
                  className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {g.counselorAccount.user.name ??
                          g.counselorAccount.orgName ??
                          "A counselor"}
                        {g.counselorAccount.orgName &&
                          g.counselorAccount.user.name && (
                            <span className="text-zinc-500">
                              {" "}
                              · {g.counselorAccount.orgName}
                            </span>
                          )}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        {profileName.get(g.studentProfileId) ?? "A student"} ·{" "}
                        {SCOPE_MEANINGS[g.scope as LinkScope]}
                      </p>
                    </div>
                    <StatusPill live={Boolean(live)} status={g.status} />
                  </div>

                  {/* Both consents shown separately, because "pending" without
                      saying whose is a status a student cannot act on. */}
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <ConsentRow
                      label="Student agreed"
                      at={g.studentConsentAt}
                      linkId={g.id}
                      who="student"
                      cta="I agree"
                    />
                    <ConsentRow
                      label="Parent or guardian agreed"
                      at={g.guardianConsentAt}
                      linkId={g.id}
                      who="guardian"
                      cta="A parent or guardian agrees"
                    />
                  </dl>

                  {!live && (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      Nothing has been shared yet. Until both agree, this person
                      sees no name, no grades, and no activities — the student
                      does not appear on their list at all.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-black/10 pt-3 dark:border-white/10">
                    <RevokeButton linkId={g.id} />
                    <p className="text-xs text-zinc-500">
                      Takes effect immediately. They are not asked, and the
                      record of what they already looked at stays below.
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── The read log ─────────────────────────────────────────────────── */}
      {readsByProfile.some((r) => r.reads.length > 0) && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">What they looked at</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-zinc-500">
              Every time a counselor opened something belonging to a student on
              this account. Kept after access ends.
            </p>
          </div>
          {readsByProfile.map(({ profileId, reads }) =>
            reads.length === 0 ? null : (
              <div
                key={profileId}
                className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5"
              >
                <h3 className="text-sm font-medium text-zinc-500">
                  {profileName.get(profileId) ?? "A student"}
                </h3>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {reads.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-400"
                    >
                      <span className="tabular-nums text-zinc-500">
                        {r.readAt.toLocaleString("en-US", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        {r.counselorAccount.user.name ??
                          r.counselorAccount.orgName ??
                          "A counselor"}
                      </span>
                      <span>{describeSurface(r.surface)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </section>
      )}

      <Link
        href="/settings"
        className="inline-block text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← Account &amp; data
      </Link>
    </div>
  );
}

function ConsentRow({
  label,
  at,
  linkId,
  who,
  cta,
}: {
  label: string;
  at: Date | null;
  linkId: string;
  who: "student" | "guardian";
  cta: string;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5">
        {at ? (
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {at.toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ) : (
          <ConsentButton linkId={linkId} who={who} label={cta} />
        )}
      </dd>
    </div>
  );
}

function StatusPill({ live, status }: { live: boolean; status: string }) {
  const tone = live
    ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300"
    : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {live ? "Can see this student" : `Waiting · ${status.toLowerCase()}`}
    </span>
  );
}

/**
 * The surface names, in words a student would use.
 *
 * The log stores app terms because those are stable; this translates them at
 * the last moment, and falls through to the raw name rather than hiding a read
 * whose surface it does not recognise. An unrecognised entry the student can
 * still see is better than a missing one.
 */
function describeSurface(surface: string): string {
  switch (surface) {
    case "caseload.attention":
      return "saw this student on their list for the week";
    case "student.detail":
      return "opened the student's page";
    case "prep.generate":
      return "drafted notes before a session";
    default:
      return surface;
  }
}
