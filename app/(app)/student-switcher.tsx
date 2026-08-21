import { getOwnedProfiles, getOrCreateProfile } from "@/lib/ownership";
import { switchStudentAction } from "@/app/actions/students";
import { studentLabel } from "@/lib/students";
import Link from "next/link";

/**
 * Which student the account is working on.
 *
 * Renders NOTHING for an account with one student. A solo student should never
 * have to learn that "students" is a concept — the feature exists for
 * counselors and agencies, and appears the moment a second student does.
 */
export async function StudentSwitcher() {
  const [profiles, active] = await Promise.all([
    getOwnedProfiles(),
    getOrCreateProfile(),
  ]);

  if (profiles.length <= 1) return null;

  return (
    <form
      action={switchStudentAction}
      className="flex min-w-0 items-center gap-2"
    >
      <label htmlFor="profileId" className="sr-only">
        Student
      </label>
      {/* React only reads a <select>'s defaultValue AT MOUNT, then reapplies
          that same captured value on every later re-render regardless of what
          the prop becomes or what the user clicks — the same defect fixed on
          the profile page's country field (see the comment there). Here it
          means switchStudentAction's write always lands (the rest of the page
          reflects the new student), but the switcher itself keeps showing
          whoever was active when it first mounted, so it visibly does not
          "hear" its own switch. Keyed by the field's own value so a real
          switch forces the remount that picks the new value back up. */}
      <select
        key={active.id}
        id="profileId"
        name="profileId"
        defaultValue={active.id}
        className="max-w-[12rem] truncate rounded-md border border-black/15 bg-surface px-2 py-1 text-sm dark:border-white/20"
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {studentLabel(p)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-black/15 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-white/20 dark:hover:bg-white/10"
      >
        Switch
      </button>
      <Link
        href="/students"
        className="whitespace-nowrap text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Manage
      </Link>
    </form>
  );
}
