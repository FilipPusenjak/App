// Application documents in the database: one live draft per document per
// cycle, and immutable exported snapshots.
//
// IMMUTABILITY IS ENFORCED HERE, not by convention. Every write to a document
// goes through saveDraft, which only ever matches a row whose status is DRAFT.
// An export is a new row, so the draft can keep changing while what the
// student submitted in October stays exactly as it was.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  isListActivity,
  mapEntryFields,
  suggestSelection,
  toActivitySource,
  type ActivitySource,
} from "./activities";
import {
  emptyCommonAppFields,
  reconcileCommonApp,
  type BragSheetFields,
  type CommonAppFields,
  type DocumentFields,
  type DocumentType,
  type ResumeFields,
} from "./fields";
import { limitsFor, type CommonAppLimits, type RecognitionLevel } from "./limits";
import { DEFAULT_BRAG_TEMPLATE_ID } from "./brag-sheet";

export { commonAppExportProblems } from "./fields";

export type HonorSource = {
  id: string;
  title: string;
  gradeLevels: number[];
  recognitionLevel: RecognitionLevel;
};

/** Everything a document is built from. Pinned into each export. */
export type SourceSnapshot = {
  builtAt: string;
  cycle: string;
  limits: CommonAppLimits;
  student: {
    name: string | null;
    gradeLevel: string | null;
    schoolName: string | null;
    graduationYear: number | null;
    gpa: number | null;
    gpaScale: string | null;
    intendedMajor: string | null;
    careerGoal: string | null;
  };
  activities: ActivitySource[];
  /** Award-type resume items, offered as honors the student has not added yet. */
  awards: { id: string; title: string; gradeLevels: number[] }[];
  honors: HonorSource[];
  courses: { title: string; org: string | null; startDate: string | null; endDate: string | null }[];
  testScores: { label: string; score: string; maxScore: string | null; predicted: boolean }[];
  targets: { name: string; course: string | null; country: string }[];
};

const RECOGNITION_ORDER: RecognitionLevel[] = ["INTERNATIONAL", "NATIONAL", "STATE_REGIONAL", "SCHOOL"];

/** Highest recognition first, then latest grade, then title. Code only. */
export function orderHonors(honors: HonorSource[]): HonorSource[] {
  return [...honors].sort(
    (a, b) =>
      RECOGNITION_ORDER.indexOf(a.recognitionLevel) - RECOGNITION_ORDER.indexOf(b.recognitionLevel) ||
      Math.max(0, ...b.gradeLevels) - Math.max(0, ...a.gradeLevels) ||
      a.title.localeCompare(b.title),
  );
}

export async function loadSourceSnapshot(
  profileId: string,
  cycle: string,
  now: Date = new Date(),
): Promise<SourceSnapshot> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      user: { select: { name: true } },
      resumeItems: { orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] },
      honors: { orderBy: { createdAt: "asc" } },
      testScores: { orderBy: { createdAt: "asc" } },
      targetSchools: { orderBy: { createdAt: "asc" } },
    },
  });

  const sources = profile.resumeItems.map((i) => toActivitySource(i, now));
  const honorTitles = new Set(profile.honors.map((h) => h.title.trim().toLowerCase()));

  return {
    builtAt: now.toISOString(),
    cycle,
    limits: limitsFor(cycle),
    student: {
      name: profile.studentName ?? profile.user.name ?? null,
      gradeLevel: profile.gradeLevel,
      schoolName: profile.schoolName,
      graduationYear: profile.graduationYear,
      gpa: profile.gpa,
      gpaScale: profile.gpaScale,
      intendedMajor: profile.intendedMajor,
      careerGoal: profile.careerGoal,
    },
    activities: sources.filter(isListActivity),
    awards: sources
      .filter((s) => s.itemType === "award" && !honorTitles.has(s.title.trim().toLowerCase()))
      .map((s) => ({ id: s.id, title: s.title, gradeLevels: s.gradeLevels })),
    honors: orderHonors(
      profile.honors.map((h) => ({
        id: h.id,
        title: h.title,
        gradeLevels: [...h.gradeLevels].sort((a, b) => a - b),
        recognitionLevel: h.recognitionLevel as RecognitionLevel,
      })),
    ),
    courses: sources
      .filter((s) => s.itemType === "coursework")
      .map((s) => ({ title: s.title, org: s.org, startDate: s.startDate, endDate: s.endDate })),
    testScores: profile.testScores.map((t) => ({
      label: t.label,
      score: t.score,
      maxScore: t.maxScore,
      predicted: t.predicted,
    })),
    targets: profile.targetSchools.map((t) => ({ name: t.name, course: t.course, country: t.country })),
  };
}

function initialFields(type: DocumentType, snapshot: SourceSnapshot): DocumentFields {
  if (type === "COMMON_APP_ACTIVITIES") {
    return emptyCommonAppFields(
      suggestSelection(snapshot.activities, {
        maxActivities: snapshot.limits.maxActivities,
        intendedMajor: snapshot.student.intendedMajor,
      }),
    );
  }
  if (type === "BRAG_SHEET") {
    const f: BragSheetFields = { kind: "BRAG_SHEET", templateId: DEFAULT_BRAG_TEMPLATE_ID, grammarOptIn: false, stories: {} };
    return f;
  }
  const r: ResumeFields = { kind: "RESUME_PDF", skills: [], includeGpa: false };
  return r;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** The one draft of this document for this student and cycle, created on first use. */
export async function getOrCreateDraft(profileId: string, type: DocumentType, cycle: string) {
  const draftKey = `${profileId}:${type}:${cycle}`;
  const existing = await prisma.applicationDocument.findUnique({ where: { draftKey } });
  if (existing) return existing;
  const snapshot = await loadSourceSnapshot(profileId, cycle);
  try {
    return await prisma.applicationDocument.create({
      data: {
        profileId,
        type,
        cycle,
        status: "DRAFT",
        draftKey,
        sourceSnapshot: json(snapshot),
        fields: json(initialFields(type, snapshot)),
      },
    });
  } catch {
    // Two first visits at once: the other one won the unique key.
    return prisma.applicationDocument.findUniqueOrThrow({ where: { draftKey } });
  }
}

export class ExportedDocumentError extends Error {
  constructor() {
    super("An exported document can't be changed.");
  }
}

/** The only way a document is written. Refuses anything that is not a draft. */
export async function saveDraft(
  id: string,
  data: {
    fields?: DocumentFields;
    sourceSnapshot?: SourceSnapshot;
    editedFieldKeys?: string[];
    orderConfirmedAt?: Date | null;
  },
) {
  const result = await prisma.applicationDocument.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      ...(data.fields ? { fields: json(data.fields) } : {}),
      ...(data.sourceSnapshot ? { sourceSnapshot: json(data.sourceSnapshot) } : {}),
      ...(data.editedFieldKeys ? { editedFieldKeys: data.editedFieldKeys } : {}),
      ...(data.orderConfirmedAt !== undefined ? { orderConfirmedAt: data.orderConfirmedAt } : {}),
    },
  });
  if (result.count === 0) throw new ExportedDocumentError();
}

/** Add a generation's tokens and cost to the draft's running totals. */
export async function addUsage(
  id: string,
  run: { inputTokens: number; outputTokens: number; costUsd: number },
) {
  await prisma.applicationDocument.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      inputTokens: { increment: run.inputTokens },
      outputTokens: { increment: run.outputTokens },
      costCents: { increment: run.costUsd * 100 },
    },
  });
}

/**
 * Bring the Common App draft up to date with the profile and save it.
 * Never touches an edited field or a confirmed order — see fields.ts.
 */
export async function refreshCommonAppDraft(profileId: string, cycle: string) {
  const draft = await getOrCreateDraft(profileId, "COMMON_APP_ACTIVITIES", cycle);
  const snapshot = await loadSourceSnapshot(profileId, cycle);
  const suggestion = suggestSelection(snapshot.activities, {
    maxActivities: snapshot.limits.maxActivities,
    intendedMajor: snapshot.student.intendedMajor,
  });
  const mapped = Object.fromEntries(
    snapshot.activities.map((a) => {
      const m = mapEntryFields(a, snapshot.limits);
      return [a.id, { position: m.position.value, organization: m.organization.value }];
    }),
  );
  const fields = reconcileCommonApp({
    fields: draft.fields as unknown as CommonAppFields,
    activities: snapshot.activities,
    mapped,
    suggestion,
    orderConfirmed: draft.orderConfirmedAt !== null,
    editedFieldKeys: draft.editedFieldKeys,
  });
  await saveDraft(draft.id, { fields, sourceSnapshot: snapshot });
  return { ...draft, fields, sourceSnapshot: snapshot };
}

/**
 * Pin the draft as it stands into a new, immutable EXPORTED row.
 *
 * `fieldsOverride` lets the resume export record what was actually drawn on
 * the page (after cutting for length) rather than the draft's wish list.
 */
export async function exportDraft(
  draftId: string,
  opts: { fieldsOverride?: unknown } = {},
) {
  const draft = await prisma.applicationDocument.findUniqueOrThrow({ where: { id: draftId } });
  if (draft.status !== "DRAFT") throw new ExportedDocumentError();
  const snapshot = await loadSourceSnapshot(draft.profileId, draft.cycle);
  return prisma.applicationDocument.create({
    data: {
      profileId: draft.profileId,
      type: draft.type,
      cycle: draft.cycle,
      status: "EXPORTED",
      draftKey: null,
      draftId: draft.id,
      sourceSnapshot: json(snapshot),
      fields: json(opts.fieldsOverride ?? draft.fields),
      editedFieldKeys: draft.editedFieldKeys,
      orderConfirmedAt: draft.orderConfirmedAt,
      exportedAt: new Date(),
    },
  });
}

export async function listExports(profileId: string, type?: DocumentType) {
  return prisma.applicationDocument.findMany({
    where: { profileId, status: "EXPORTED", ...(type ? { type } : {}) },
    orderBy: { exportedAt: "desc" },
    select: { id: true, type: true, cycle: true, exportedAt: true },
  });
}
