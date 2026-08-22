// The tutor's student list.
//
// WHAT THIS FILE MUST NEVER PRODUCE, and there is a test reading this file to
// keep it that way:
//
//   A RANKING BY SCORE, PROGRESS, OR IMPROVEMENT. Same reasoning as the
//   counselor edition's caseload, and it lands harder here because the numbers
//   are right there and sorting by them is one line. A tutor's screen listing
//   their students by improvement is a leaderboard of children, it invites the
//   comparison a family would be appalled to learn was being made, and it would
//   be the first screenshot to leak.
//
//   A CASELOAD-WIDE AVERAGE. "Your students gain an average of 90 points" is a
//   marketing statistic about a sample of forty, it tells the tutor nothing they
//   can act on tomorrow, and its only real use is on a sales page.
//
// The order is by NAME. Not a default nobody thought about: every other ordering
// a test-prep roster could take is a ranking by something, and the candidates
// are precisely the measures above.
import { prisma } from "@/lib/db";
import { TUTOR_PROFILE_SELECT, listTutorLinks } from "./access";
import { STOPPING_LABELS, type StoppingKind } from "@/lib/validation/testprep";

export type RosterRow = {
  linkId: string;
  studentProfileId: string;
  studentName: string;
  gradeLevel: string | null;
  graduationYear: number | null;
  /**
   * Whether a stopping signal is live and UNACKNOWLEDGED.
   *
   * A boolean, deliberately — not a severity, not a count, nothing sortable
   * into an order. It exists so the one student the tutor owes a conversation
   * is visible without the list becoming a ranking.
   */
  needsStoppingAcknowledgement: boolean;
  /** The label, when one is live. Read, never sorted on. */
  stoppingLabel: string | null;
};

export async function loadRoster(): Promise<RosterRow[]> {
  const links = await listTutorLinks();
  if (links.length === 0) return [];

  const profileIds = links.map((l) => l.studentProfileId);
  const studentUserIds = links.map((l) => l.studentUserId);

  const [profiles, signals] = await Promise.all([
    prisma.profile.findMany({
      where: { id: { in: profileIds } },
      select: TUTOR_PROFILE_SELECT,
    }),
    prisma.stoppingSignal.findMany({
      where: {
        studentUserId: { in: studentUserIds },
        resolvedAt: null,
        acknowledgedByTutorAt: null,
      },
      select: { studentUserId: true, kind: true },
    }),
  ]);

  const byProfile = new Map(profiles.map((p) => [p.id, p]));
  const unacknowledged = new Map<string, StoppingKind>();
  for (const s of signals) {
    // ALL_TARGETS_MET is the one worth surfacing when several are live — it is
    // the strongest form and the one a tutor must actually act on.
    const existing = unacknowledged.get(s.studentUserId);
    if (!existing || s.kind === "ALL_TARGETS_MET") {
      unacknowledged.set(s.studentUserId, s.kind as StoppingKind);
    }
  }

  const rows: RosterRow[] = links.flatMap((link) => {
    const profile = byProfile.get(link.studentProfileId);
    if (!profile) return [];
    const kind = unacknowledged.get(link.studentUserId) ?? null;
    return [
      {
        linkId: link.id,
        studentProfileId: link.studentProfileId,
        studentName: profile.studentName ?? "Unnamed student",
        gradeLevel: profile.gradeLevel,
        graduationYear: profile.graduationYear,
        needsStoppingAcknowledgement: kind !== null,
        stoppingLabel: kind ? STOPPING_LABELS[kind] : null,
      },
    ];
  });

  // BY NAME. See the file header for why this is the only defensible ordering.
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
}
