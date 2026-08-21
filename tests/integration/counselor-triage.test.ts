// The triage pass, against a real database.
//
// The claims worth proving here are the ones a unit test cannot make: that a
// hundred-student caseload is triaged inside a nightly job's budget, that a
// signal which stops being true stops being shown, and that a signal which is
// still true does not reappear as news every morning.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("cnsl-triage");

vi.mock("@/lib/session", () => ({
  requireUserId: async () => "unused-in-this-file",
  getCurrentUser: async () => ({ id: "unused-in-this-file" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { runTriage } = await import("@/lib/counselor/triage/run");

const NOW = new Date("2026-10-15T00:00:00Z");
const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("the triage pass", () => {
  let counselorAccountId = "";

  beforeEach(async () => {
    const counselor = await createUserWithProfile(
      runTag,
      `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    const account = await prisma.counselorAccount.create({
      data: { userId: counselor.user.id, orgName: "Triage Test" },
    });
    counselorAccountId = account.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  /** A linked student, with whatever profile state a test needs. */
  async function linkStudent(
    profile: Record<string, unknown> = {},
    link: Record<string, unknown> = {},
  ) {
    const student = await createUserWithProfile(
      runTag,
      `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    );
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: profile,
    });
    const row = await prisma.caseloadLink.create({
      data: {
        counselorAccountId,
        studentUserId: student.user.id,
        studentProfileId: student.profile.id,
        invitedBy: "COUNSELOR",
        status: "ACTIVE",
        studentConsentAt: NOW,
        guardianConsentAt: NOW,
        startedAt: NOW,
        ...link,
      },
    });
    return { ...student, linkId: row.id };
  }

  const signalsFor = (linkId: string) =>
    prisma.triageSignal.findMany({
      where: { caseloadLinkId: linkId, resolvedAt: null },
      orderBy: { severity: "desc" },
    });

  it("runs with zero model calls", async () => {
    await linkStudent({ gradeLevel: "Grade 12" });
    const result = await runTriage({ counselorAccountId, now: NOW });
    // Asserted as a returned fact, and enforced structurally by the source-level
    // test in tests/unit/triage-severity.test.ts.
    expect(result.modelCalls).toBe(0);
    expect(result.linksExamined).toBe(1);
  });

  it("triages a 100-student caseload inside a nightly budget", async () => {
    // The brief's own number. Built with realistic content rather than empty
    // profiles, or the query count being tested would not be the real one.
    const students = await Promise.all(
      Array.from({ length: 100 }, () =>
        linkStudent({ gradeLevel: "Grade 11", intendedMajor: "Physics" }),
      ),
    );
    await prisma.resumeItem.createMany({
      data: students.flatMap((s) => [
        {
          profileId: s.profile.id,
          type: "project",
          title: "Robotics club",
          startDate: new Date(NOW.getTime() - 700 * DAY),
          rungLevel: "participant",
        },
        { profileId: s.profile.id, type: "coursework", title: "AP Physics" },
      ]),
    });

    const started = Date.now();
    const result = await runTriage({ counselorAccountId, now: NOW });
    const elapsed = Date.now() - started;

    expect(result.linksExamined).toBe(100);
    expect(result.modelCalls).toBe(0);
    // Generous, because CI machines vary. The failure this guards against is
    // per-student query loading, which is an order of magnitude slower rather
    // than a few percent — a caseload that takes minutes rather than seconds.
    expect(
      elapsed,
      `triaging 100 students took ${elapsed}ms — check for per-student queries`,
    ).toBeLessThan(30_000);
  });

  describe("what it notices", () => {
    it("flags a senior who has gone quiet, and not a freshman", async () => {
      const quietSenior = await linkStudent({ gradeLevel: "Grade 12" });
      const quietFreshman = await linkStudent({ gradeLevel: "Grade 9" });

      // Both untouched for a month. Only one of them is a problem.
      const monthAgo = new Date(NOW.getTime() - 30 * DAY);
      for (const s of [quietSenior, quietFreshman]) {
        await prisma.$executeRaw`UPDATE "Profile" SET "updatedAt" = ${monthAgo} WHERE id = ${s.profile.id}`;
      }

      await runTriage({ counselorAccountId, now: NOW });

      const senior = await signalsFor(quietSenior.linkId);
      const freshman = await signalsFor(quietFreshman.linkId);
      expect(senior.map((s) => s.kind)).toContain("STALE_PROFILE");
      expect(freshman.map((s) => s.kind)).not.toContain("STALE_PROFILE");
    });

    it("flags an overdue commitment the student accepted", async () => {
      const s = await linkStudent({ gradeLevel: "Grade 11" });
      await prisma.commitment.create({
        data: {
          profileId: s.profile.id,
          description: "Send the write-up to a teacher",
          status: "ACCEPTED",
          dueDate: new Date(NOW.getTime() - 40 * DAY),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      const signals = await signalsFor(s.linkId);
      const overdue = signals.find((x) => x.kind === "COMMITMENT_OVERDUE");
      expect(overdue).toBeDefined();
      expect((overdue!.basis as Record<string, unknown>).daysOverdue).toBe(40);
    });

    it("does NOT flag an unanswered proposal as a broken promise", async () => {
      // A PROPOSED commitment the student never answered is an unread
      // suggestion from the app, not a commitment they failed to keep. Putting
      // the app's own unread advice in front of a counselor as if the student
      // had let them down would be dishonest about who did what.
      const s = await linkStudent({ gradeLevel: "Grade 11" });
      await prisma.commitment.create({
        data: {
          profileId: s.profile.id,
          description: "Never answered",
          status: "PROPOSED",
          dueDate: new Date(NOW.getTime() - 40 * DAY),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      const signals = await signalsFor(s.linkId);
      expect(signals.map((x) => x.kind)).not.toContain("COMMITMENT_OVERDUE");
    });

    it("raises nothing about thresholds on a FIRST evaluation", async () => {
      // "Newly binding" is a diff. With one snapshot every unmet component
      // would look new, which would bury a counselor on the day they onboard.
      const s = await linkStudent({ gradeLevel: "Grade 12" });
      await prisma.evaluation.create({
        data: {
          profileId: s.profile.id,
          status: "completed",
          promptVersion: "evaluation/v11",
          thresholdSnapshotJson: JSON.stringify({
            schools: [
              {
                targetName: "Imperial",
                components: [{ label: "Chemistry", state: "UNMET" }],
              },
            ],
          }),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      const signals = await signalsFor(s.linkId);
      expect(signals.map((x) => x.kind)).not.toContain("THRESHOLD_NEWLY_BINDING");
    });

    it("flags a component that went from satisfiable to unmet", async () => {
      const s = await linkStudent({ gradeLevel: "Grade 12" });
      const before = new Date(NOW.getTime() - 60 * DAY);
      await prisma.evaluation.create({
        data: {
          profileId: s.profile.id,
          status: "completed",
          createdAt: before,
          promptVersion: "evaluation/v11",
          thresholdSnapshotJson: JSON.stringify({
            schools: [
              {
                targetName: "Imperial",
                components: [{ label: "Chemistry", state: "PARTIAL" }],
              },
            ],
          }),
        },
      });
      await prisma.evaluation.create({
        data: {
          profileId: s.profile.id,
          status: "completed",
          promptVersion: "evaluation/v11",
          thresholdSnapshotJson: JSON.stringify({
            schools: [
              {
                targetName: "Imperial",
                components: [{ label: "Chemistry", state: "UNMET" }],
              },
            ],
          }),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      const signals = await signalsFor(s.linkId);
      const binding = signals.find((x) => x.kind === "THRESHOLD_NEWLY_BINDING");
      expect(binding).toBeDefined();
      // A senior with an unreachable requirement is the top of the scale.
      expect(binding!.severity).toBe(5);
      const basis = binding!.basis as Record<string, unknown>;
      expect(basis.component).toBe("Chemistry");
      expect(basis.previousState).toBe("PARTIAL");
    });

    it("gives every signal a basis a counselor can inspect", async () => {
      const s = await linkStudent({ gradeLevel: "Grade 12" });
      await runTriage({ counselorAccountId, now: NOW });

      const signals = await signalsFor(s.linkId);
      expect(signals.length).toBeGreaterThan(0);
      for (const signal of signals) {
        const basis = signal.basis as Record<string, unknown>;
        expect(basis, `${signal.kind} has no basis`).toBeTruthy();
        // Every basis names the deterministic fact behind it. "The system said
        // so" is not something a professional can repeat to a paying parent.
        expect(typeof basis.signal, `${signal.kind} basis has no signal name`).toBe("string");
      }
    });
  });

  describe("what it does across runs", () => {
    it("does not report the same standing problem as new every night", async () => {
      // The failure that would make a counselor stop reading the list: a
      // fortnight-old overdue commitment announcing itself every morning.
      const s = await linkStudent({ gradeLevel: "Grade 11" });
      await prisma.commitment.create({
        data: {
          profileId: s.profile.id,
          description: "Still not done",
          status: "ACCEPTED",
          dueDate: new Date(NOW.getTime() - 40 * DAY),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      const first = await signalsFor(s.linkId);

      // A day later, nothing has changed.
      const tomorrow = new Date(NOW.getTime() + DAY);
      const second = await runTriage({ counselorAccountId, now: tomorrow });
      const after = await signalsFor(s.linkId);

      expect(after).toHaveLength(first.length);
      // computedAt still means "when this first became true", which is what a
      // counselor reads it as.
      const overdueBefore = first.find((x) => x.kind === "COMMITMENT_OVERDUE")!;
      const overdueAfter = after.find((x) => x.kind === "COMMITMENT_OVERDUE")!;
      expect(overdueAfter.id).toBe(overdueBefore.id);
      expect(second.signalsWritten).toBe(0);
    });

    it("resolves a signal once it stops being true", async () => {
      const s = await linkStudent({ gradeLevel: "Grade 11" });
      const commitment = await prisma.commitment.create({
        data: {
          profileId: s.profile.id,
          description: "Will be done",
          status: "ACCEPTED",
          dueDate: new Date(NOW.getTime() - 40 * DAY),
        },
      });

      await runTriage({ counselorAccountId, now: NOW });
      expect((await signalsFor(s.linkId)).map((x) => x.kind)).toContain(
        "COMMITMENT_OVERDUE",
      );

      // The student finishes it.
      await prisma.commitment.update({
        where: { id: commitment.id },
        data: { status: "COMPLETED", resolvedAt: NOW },
      });
      await runTriage({ counselorAccountId, now: new Date(NOW.getTime() + DAY) });

      // Gone from the open list, and still on the record as having happened.
      expect((await signalsFor(s.linkId)).map((x) => x.kind)).not.toContain(
        "COMMITMENT_OVERDUE",
      );
      const resolved = await prisma.triageSignal.findMany({
        where: { caseloadLinkId: s.linkId, resolvedAt: { not: null } },
      });
      expect(resolved.length).toBeGreaterThan(0);
    });
  });

  describe("consent governs monitoring too", () => {
    it("does not triage a link awaiting a guardian", async () => {
      // Triage reads student data, so it obeys the same gate every other read
      // does. Monitoring someone who has not consented is still surveillance.
      const s = await linkStudent(
        { gradeLevel: "Grade 12" },
        { guardianConsentAt: null },
      );
      const result = await runTriage({ counselorAccountId, now: NOW });
      expect(result.linksExamined).toBe(0);
      expect(await signalsFor(s.linkId)).toHaveLength(0);
    });

    it("does not triage an ENDED link", async () => {
      const s = await linkStudent(
        { gradeLevel: "Grade 12" },
        { status: "ENDED", endedAt: NOW },
      );
      await runTriage({ counselorAccountId, now: NOW });
      expect(await signalsFor(s.linkId)).toHaveLength(0);
    });
  });
});
