// What students across the caseload have agreed to, in date order.
//
// WHY THIS IS A SCREEN AND NOT A SIGNAL. Triage already raises
// COMMITMENT_OVERDUE, which fires the day after something is late. That is a
// report, and by the time a counselor reads it the window to help has closed:
// a letter request that needed to reach a teacher before term started cannot be
// un-missed. This screen is the same data one week earlier, which is the
// difference between preventing and recording.
//
// READ-ONLY, AND NOT BY OVERSIGHT. A Commitment belongs to the student — they
// accepted it and they are the only one who can say it is done. Nothing here
// writes, lib/counselor/access.ts has no write path to offer, and a
// source-level test in tests/unit/counselor-guarantees.test.ts fails if this
// file ever acquires one. What a counselor does about a late commitment is have
// a conversation, and a checkbox on this screen would quietly turn their
// student's record into their own to-do list.
//
// A PROPOSED COMMITMENT IS NOT A BROKEN PROMISE. The app proposes; the student
// accepts. Something the student never answered is an unanswered suggestion,
// and lumping it in with what they agreed to and missed would put the app's own
// unread advice in front of a counselor as if a child had let them down. The
// two are separated here for exactly the reason detectSignals separates them.
import { prisma } from "@/lib/db";
import { requireCounselorPage, readableLinkWhere } from "./access";

/** Statuses that describe something still live between a counselor and a student. */
const LIVE = ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] as const;
/** Statuses that describe something finished, either way. */
const CLOSED = ["COMPLETED", "ABANDONED"] as const;

/** How far back a finished commitment stays worth showing. */
const RECENTLY_CLOSED_DAYS = 30;
/** The near horizon — what "this week" means on this screen. */
const SOON_DAYS = 7;

const DAY_MS = 86_400_000;

export type CommitmentRow = {
  id: string;
  linkId: string;
  studentName: string;
  gradeLevel: string | null;
  description: string;
  status: string;
  dueDate: Date | null;
  /** Negative when the date has passed. Null when there is no date at all. */
  daysUntilDue: number | null;
  targetRung: string | null;
  resolvedAt: Date | null;
};

/**
 * The buckets this screen renders, in the order it renders them.
 *
 * Time-ordered, never student-ordered. The list answers "what is about to
 * matter", and grouping it by person would turn a work queue into a comparison
 * of children — which is the thing this whole product refuses to produce.
 */
export type CaseloadCommitments = {
  /** Agreed to, past its date. The ones triage has already raised or will. */
  overdue: CommitmentRow[];
  /** Agreed to, due inside the next week. The reason this screen exists. */
  soon: CommitmentRow[];
  /** Agreed to, due later, or with no date at all. */
  later: CommitmentRow[];
  /** Proposed and never answered. NOT a broken promise — see the header. */
  unanswered: CommitmentRow[];
  /** Finished in the last month, either way, for continuity between sessions. */
  recentlyClosed: CommitmentRow[];
  /** Everything live, for the count a counselor reads first. */
  liveCount: number;
  /** How many students on the caseload have nothing live at all. */
  studentsWithNothingLive: number;
  totalActive: number;
};

export async function loadCaseloadCommitments(
  now = new Date(),
): Promise<CaseloadCommitments> {
  const account = await requireCounselorPage();

  // The links first, because they are the authorisation. A commitment is
  // reachable only through a link that is ACTIVE and dually consented, so the
  // profile ids come from that query rather than from the commitments table.
  const links = await prisma.caseloadLink.findMany({
    where: readableLinkWhere(account.id),
    select: {
      id: true,
      studentProfileId: true,
      studentProfile: { select: { studentName: true, gradeLevel: true } },
    },
  });

  if (links.length === 0) {
    return empty();
  }

  const byProfile = new Map(links.map((l) => [l.studentProfileId, l]));
  const closedSince = new Date(now.getTime() - RECENTLY_CLOSED_DAYS * DAY_MS);

  const rows = await prisma.commitment.findMany({
    where: {
      profileId: { in: [...byProfile.keys()] },
      OR: [
        { status: { in: [...LIVE] } },
        { status: { in: [...CLOSED] }, resolvedAt: { gte: closedSince } },
      ],
    },
    // By DATE, and by nothing about the student. Nulls last so an undated
    // commitment does not sit above one that is due on Friday.
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: {
      id: true,
      profileId: true,
      description: true,
      status: true,
      dueDate: true,
      targetRung: true,
      resolvedAt: true,
    },
  });

  const out: CaseloadCommitments = { ...empty(), totalActive: links.length };
  const withSomethingLive = new Set<string>();

  for (const c of rows) {
    const link = byProfile.get(c.profileId);
    if (!link) continue;

    const days =
      c.dueDate === null
        ? null
        : Math.floor((c.dueDate.getTime() - now.getTime()) / DAY_MS);

    const row: CommitmentRow = {
      id: c.id,
      linkId: link.id,
      studentName: link.studentProfile.studentName ?? "Unnamed student",
      gradeLevel: link.studentProfile.gradeLevel,
      description: c.description,
      status: c.status,
      dueDate: c.dueDate,
      daysUntilDue: days,
      targetRung: c.targetRung,
      resolvedAt: c.resolvedAt,
    };

    if ((CLOSED as readonly string[]).includes(c.status)) {
      out.recentlyClosed.push(row);
      continue;
    }

    withSomethingLive.add(c.profileId);
    out.liveCount += 1;

    if (c.status === "PROPOSED") {
      out.unanswered.push(row);
    } else if (days !== null && days < 0) {
      out.overdue.push(row);
    } else if (days !== null && days <= SOON_DAYS) {
      out.soon.push(row);
    } else {
      out.later.push(row);
    }
  }

  // Overdue already reads longest-overdue first, because ascending by dueDate
  // puts the earliest date at the top and an earlier date IS further past. A
  // reverse() here looked right and produced exactly the wrong order — a thing
  // three weeks late has been missed once already and outranks one that slipped
  // yesterday.
  out.studentsWithNothingLive = links.length - withSomethingLive.size;
  return out;
}

function empty(): CaseloadCommitments {
  return {
    overdue: [],
    soon: [],
    later: [],
    unanswered: [],
    recentlyClosed: [],
    liveCount: 0,
    studentsWithNothingLive: 0,
    totalActive: 0,
  };
}

/** How a due date reads on screen. Plain words, because a date needs reading twice. */
export function describeDue(row: CommitmentRow): string {
  if (row.dueDate === null) return "no date set";
  const d = row.daysUntilDue!;
  if (d < -1) return `${Math.abs(d)} days past its date`;
  if (d === -1) return "was due yesterday";
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}
