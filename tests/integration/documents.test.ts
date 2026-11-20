// The application document builder through its real routes and database.
//
// Only the session and the model are stubbed, and the model stub counts calls:
// "refused" must mean no request was ever built, and "served from the cache"
// must mean exactly zero calls.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("documents");
const d = hasTestDb ? describe : describe.skip;

const session = { userId: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => session.userId,
  getCurrentUser: async () => ({ id: session.userId, email: "x@example.test" }),
  getCurrentDbUser: async () => ({ id: session.userId, email: "x@example.test" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

/** What the model stub answers for each entry id; unset ids echo the first fact. */
const modelCalls = vi.fn();
const replies = new Map<string, string>();
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (args: { messages: { content: string }[] }) => {
          modelCalls(args);
          const sent = JSON.parse(args.messages[0]!.content) as {
            entries?: { entryId: string; facts: string[] }[];
          };
          const entries = (sent.entries ?? []).map((e) => ({
            entryId: e.entryId,
            description: replies.get(e.entryId) ?? e.facts[0] ?? "",
          }));
          return {
            content: [{ type: "text", text: JSON.stringify({ entries }) }],
            usage: { input_tokens: 500, output_tokens: 60 },
          };
        },
      },
    }),
  };
});

const generate = (await import("@/app/api/documents/common-app/generate/route")).POST;
const patchField = (await import("@/app/api/documents/common-app/field/route")).PATCH;
const putOrder = (await import("@/app/api/documents/common-app/order/route")).PUT;
const exportCommonApp = (await import("@/app/api/documents/common-app/export/route")).POST;
const patchActivity = (await import("@/app/api/documents/activities/[id]/route")).PATCH;
const addHonor = (await import("@/app/api/documents/honors/route")).POST;
const deleteHonor = (await import("@/app/api/documents/honors/[id]/route")).DELETE;
const patchBrag = (await import("@/app/api/documents/brag-sheet/route")).PATCH;
const grammar = (await import("@/app/api/documents/brag-sheet/grammar/route")).POST;
const exportBrag = (await import("@/app/api/documents/brag-sheet/export/route")).POST;
const patchResume = (await import("@/app/api/documents/resume/route")).PATCH;
const exportResume = (await import("@/app/api/documents/resume/export/route")).POST;
const exportPdf = (await import("@/app/api/documents/exports/[id]/pdf/route")).GET;
const { documentsGate } = await import("@/lib/documents/page-data");
const { saveDraft, ExportedDocumentError } = await import("@/lib/documents/store");

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/documents", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let seq = 0;
const later = () => new Date(Date.now() + 30 * 86_400_000);

async function student(opts: { paid: boolean }) {
  const made = await createUserWithProfile(runTag, `s${seq++}`);
  await prisma.user.update({ where: { id: made.user.id }, data: { activeProfileId: made.profile.id } });
  if (opts.paid) {
    await prisma.subscription.create({
      data: {
        userId: made.user.id,
        planCode: "STUDENT_PLUS",
        status: "active",
        stripeSubscriptionId: `sub_docs_${made.user.id}`,
        stripeCustomerId: `cus_${made.user.id}`,
        currentPeriodEnd: later(),
      },
    });
  }
  session.userId = made.user.id;
  return made;
}

async function activity(profileId: string, over: Record<string, unknown> = {}) {
  return prisma.resumeItem.create({
    data: {
      profileId,
      type: "extracurricular",
      title: "Robotics club",
      org: "Lakeview High",
      description: "I attend weekly meetings and help build the robot.",
      hoursPerWeek: 4,
      weeksPerYear: 30,
      gradeLevels: [10, 11],
      timing: "SCHOOL_YEAR",
      commonAppType: "Robotics",
      facts: ["Built the drivetrain for the robot", "Attend weekly build meetings"],
      startDate: new Date("2024-09-01"),
      ...over,
    },
  });
}

d("the application document builder", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    modelCalls.mockClear();
    replies.clear();
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("refuses a free account on every route, and builds nothing", async () => {
    const { profile } = await student({ paid: false });
    const item = await activity(profile.id);

    const calls: [string, () => Promise<Response>][] = [
      ["generate", () => generate(req("POST", {}))],
      ["field", () => patchField(req("PATCH", { activityId: item.id, field: "description", value: "x" }))],
      ["order", () => putOrder(req("PUT", { order: [item.id] }))],
      ["common-app export", () => exportCommonApp()],
      ["activity answer", () => patchActivity(req("PATCH", { weeksPerYear: 20 }), ctx(item.id))],
      ["add honor", () => addHonor(req("POST", { title: "Award", recognitionLevel: "SCHOOL" }))],
      ["delete honor", () => deleteHonor(req("DELETE"), ctx("nope"))],
      ["brag sheet", () => patchBrag(req("PATCH", { grammarOptIn: true }))],
      ["grammar", () => grammar(req("POST", { promptId: "proud" }))],
      ["brag export", () => exportBrag()],
      ["resume", () => patchResume(req("PATCH", { includeGpa: true }))],
      ["resume export", () => exportResume(req("POST", { contact: { name: "A", phone: "555" }, remember: true }))],
      ["export pdf", () => exportPdf(req("GET"), ctx("nope"))],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect((await res.json()).code, name).toBe("PLUS_REQUIRED");
    }
    expect(modelCalls).not.toHaveBeenCalled();
    expect(await prisma.applicationDocument.count({ where: { profileId: profile.id } })).toBe(0);
    expect(await prisma.honor.count({ where: { profileId: profile.id } })).toBe(0);
    expect(await prisma.savedResumeContact.count({ where: { profileId: profile.id } })).toBe(0);
    const unchanged = await prisma.resumeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(unchanged.weeksPerYear).toBe(30);
  });

  it("shows a free account the synthetic preview, never its own data", async () => {
    const { profile } = await student({ paid: false });
    await activity(profile.id, { title: "Zebrafish Genome Volunteer Squad", org: "Quintessa Institute" });

    const gate = await documentsGate();
    expect(gate.locked).toBe(true);
    const shown = JSON.stringify(gate);
    expect(shown).not.toContain("Zebrafish");
    expect(shown).not.toContain("Quintessa");
    expect(shown).not.toContain(profile.id);
    expect(await prisma.applicationDocument.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("unlocks for a student linked to a counselor on a paid plan", async () => {
    const { user, profile } = await student({ paid: false });
    const counselor = await createUserWithProfile(runTag, `c${seq++}`);
    const account = await prisma.counselorAccount.create({ data: { userId: counselor.user.id } });
    await prisma.subscription.create({
      data: {
        userId: counselor.user.id,
        planCode: "COUNSELOR_20",
        status: "active",
        stripeSubscriptionId: `sub_docs_c_${counselor.user.id}`,
        stripeCustomerId: `cus_${counselor.user.id}`,
        currentPeriodEnd: later(),
      },
    });
    await prisma.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: user.id,
        studentProfileId: profile.id,
        invitedBy: "COUNSELOR",
        status: "ACTIVE",
        studentConsentAt: new Date(),
        guardianConsentAt: new Date(),
        startedAt: new Date(),
      },
    });
    session.userId = user.id;
    expect((await documentsGate()).locked).toBe(false);
  });

  it("writes gap answers to the profile's own activity", async () => {
    const { profile } = await student({ paid: true });
    const item = await activity(profile.id, { weeksPerYear: null, timing: null, facts: [] });

    const res = await patchActivity(
      req("PATCH", { weeksPerYear: 36, timing: "ALL_YEAR", addFact: "Programmed the autonomous routine" }),
      ctx(item.id),
    );
    expect(res.status).toBe(200);
    const saved = await prisma.resumeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(saved.weeksPerYear).toBe(36);
    expect(saved.timing).toBe("ALL_YEAR");
    expect(saved.facts).toEqual(["Programmed the autonomous routine"]);
  });

  it("will not answer for another student's activity", async () => {
    const other = await student({ paid: true });
    const theirs = await activity(other.profile.id);
    await student({ paid: true });
    const res = await patchActivity(req("PATCH", { weeksPerYear: 1 }), ctx(theirs.id));
    expect(res.status).toBe(404);
    expect((await prisma.resumeItem.findUniqueOrThrow({ where: { id: theirs.id } })).weeksPerYear).toBe(30);
  });

  it("serves an unchanged list from the cache with zero model calls, and never rewrites an edit", async () => {
    const { profile } = await student({ paid: true });
    const a = await activity(profile.id, { title: "Robotics club" });
    const b = await activity(profile.id, { title: "Food bank", facts: ["Sort donations on Saturdays"] });

    const first = await generate(req("POST", {}));
    expect(first.status).toBe(200);
    expect(modelCalls).toHaveBeenCalledTimes(1);

    // The student edits one description.
    expect((await patchField(req("PATCH", { activityId: a.id, field: "description", value: "My own words" }))).status).toBe(200);

    modelCalls.mockClear();
    const second = await generate(req("POST", {}));
    const body = await second.json();
    expect(modelCalls).not.toHaveBeenCalled();
    expect(body.skippedEdited).toContain(a.id);
    expect(body.modelCalls).toBe(0);

    const draft = await prisma.applicationDocument.findFirstOrThrow({
      where: { profileId: profile.id, type: "COMMON_APP_ACTIVITIES", status: "DRAFT" },
    });
    const fields = draft.fields as { entries: Record<string, { description: string }> };
    expect(fields.entries[a.id]!.description).toBe("My own words");
    expect(fields.entries[b.id]!.description).toBe("Sort donations on Saturdays");

    const logs = await prisma.documentGenerationLog.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.modelCalls)).toEqual([1, 0]);
    expect(logs[0]!.inputTokens).toBe(500);
    expect(logs[0]!.costCents).toBeGreaterThan(0);
  });

  it("flags an inflated description with the offending word instead of using it", async () => {
    const { profile } = await student({ paid: true });
    const a = await activity(profile.id);
    replies.set(a.id, "Led the robotics club's weekly build meetings");

    await generate(req("POST", { activityId: a.id }));
    expect(modelCalls).toHaveBeenCalledTimes(2); // the batch, then one retry

    const draft = await prisma.applicationDocument.findFirstOrThrow({
      where: { profileId: profile.id, type: "COMMON_APP_ACTIVITIES", status: "DRAFT" },
    });
    const entry = (draft.fields as { entries: Record<string, { descriptionStatus: string; flag: { tokens?: string[] } | null }> }).entries[a.id]!;
    expect(entry.descriptionStatus).toBe("flagged");
    expect(entry.flag?.tokens).toContain("Led");
    const log = await prisma.documentGenerationLog.findFirstOrThrow({ where: { profileId: profile.id } });
    expect(JSON.stringify(log.fidelityFailures)).toContain("Led");
    expect(log.modelUsed).toBeTruthy();
  });

  it("exports the confirmed order, and an export never changes afterwards", async () => {
    const { profile } = await student({ paid: true });
    const a = await activity(profile.id, { title: "Alpha" });
    const b = await activity(profile.id, { title: "Beta", rungLevel: "leader" });

    // Refused until the order is confirmed.
    expect((await exportCommonApp()).status).toBe(422);

    expect((await putOrder(req("PUT", { order: [a.id, b.id] }))).status).toBe(200);
    await patchField(req("PATCH", { activityId: a.id, field: "description", value: "First version" }));
    const res = await exportCommonApp();
    expect(res.status).toBe(200);
    const { id } = await res.json();

    const exported = await prisma.applicationDocument.findUniqueOrThrow({ where: { id } });
    expect((exported.fields as { order: string[] }).order).toEqual([a.id, b.id]);

    // Keep editing the draft: the export stays exactly as it was.
    await patchField(req("PATCH", { activityId: a.id, field: "description", value: "Second version" }));
    await putOrder(req("PUT", { order: [b.id, a.id] }));
    const after = await prisma.applicationDocument.findUniqueOrThrow({ where: { id } });
    expect(after.fields).toEqual(exported.fields);
    expect((after.fields as { entries: Record<string, { description: string }> }).entries[a.id]!.description).toBe("First version");

    await expect(saveDraft(id, { editedFieldKeys: [] })).rejects.toBeInstanceOf(ExportedDocumentError);
  });

  it("refuses to export a description over its limit", async () => {
    const { profile } = await student({ paid: true });
    const a = await activity(profile.id);
    await putOrder(req("PUT", { order: [a.id] }));
    await patchField(req("PATCH", { activityId: a.id, field: "description", value: "x".repeat(151) }));
    const res = await exportCommonApp();
    expect(res.status).toBe(422);
    expect(await prisma.applicationDocument.count({ where: { profileId: profile.id, status: "EXPORTED" } })).toBe(0);
  });

  it("keeps a story byte-for-byte when grammar fixes are off, and never calls the model", async () => {
    const { profile } = await student({ paid: true });
    const story = "  the week our bridge snapped,, we rebuilt it in 2 days 🙂\n\n  tabs\tand  spaces ";
    expect((await patchBrag(req("PATCH", { story: { promptId: "proud", text: story } }))).status).toBe(200);

    const refused = await grammar(req("POST", { promptId: "proud" }));
    expect(refused.status).toBe(409);
    expect(modelCalls).not.toHaveBeenCalled();

    const exportRes = await exportBrag();
    expect(exportRes.status).toBe(200);

    const draft = await prisma.applicationDocument.findFirstOrThrow({
      where: { profileId: profile.id, type: "BRAG_SHEET", status: "DRAFT" },
    });
    const saved = (draft.fields as { stories: Record<string, { text: string }> }).stories.proud!.text;
    expect(Buffer.from(saved).equals(Buffer.from(story))).toBe(true);
    const exported = await prisma.applicationDocument.findFirstOrThrow({
      where: { profileId: profile.id, type: "BRAG_SHEET", status: "EXPORTED" },
    });
    expect((exported.fields as { stories: Record<string, { text: string }> }).stories.proud!.text).toBe(story);
  });

  it("does not keep contact details unless asked, and forgets them when told", async () => {
    const { profile } = await student({ paid: true });
    await activity(profile.id);
    const contact = { name: "Pat Example", email: "pat-contact@example.test", phone: "555-0142", address: "12 Elm St, Springfield" };

    const res = await exportResume(req("POST", { contact, remember: false }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const everything = JSON.stringify(await prisma.applicationDocument.findMany({ where: { profileId: profile.id } }));
    for (const v of [contact.email, contact.phone, contact.address]) expect(everything).not.toContain(v);
    expect(await prisma.savedResumeContact.count({ where: { profileId: profile.id } })).toBe(0);

    await exportResume(req("POST", { contact, remember: true }));
    expect((await prisma.savedResumeContact.findUniqueOrThrow({ where: { profileId: profile.id } })).phone).toBe("555-0142");
    // Even when remembered, the export rows never carry them.
    const again = JSON.stringify(await prisma.applicationDocument.findMany({ where: { profileId: profile.id } }));
    expect(again).not.toContain(contact.phone);

    await exportResume(req("POST", { contact, remember: false }));
    expect(await prisma.savedResumeContact.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("prints GPA only when the student opts in", async () => {
    const { profile } = await student({ paid: true });
    await prisma.profile.update({ where: { id: profile.id }, data: { gpa: 3.7, gpaScale: "4.0" } });
    await activity(profile.id);

    await exportResume(req("POST", { contact: { name: "A" }, remember: false }));
    await patchResume(req("PATCH", { includeGpa: true }));
    await exportResume(req("POST", { contact: { name: "A" }, remember: false }));

    const exports = await prisma.applicationDocument.findMany({
      where: { profileId: profile.id, type: "RESUME_PDF", status: "EXPORTED" },
      orderBy: { exportedAt: "asc" },
    });
    const detail = (e: (typeof exports)[number]) =>
      (e.fields as { printed: { education: { detail: string | null } } }).printed.education.detail ?? "";
    expect(detail(exports[0]!)).not.toContain("GPA");
    expect(detail(exports[1]!)).toContain("GPA 3.7");
  });

  it("re-downloads only the student's own exports", async () => {
    const owner = await student({ paid: true });
    await activity(owner.profile.id);
    const res = await exportResume(req("POST", { contact: { name: "A" }, remember: false }));
    const exportId = res.headers.get("X-Export-Id")!;
    expect((await exportPdf(req("GET"), ctx(exportId))).status).toBe(200);

    await student({ paid: true });
    expect((await exportPdf(req("GET"), ctx(exportId))).status).toBe(404);
  });
});
