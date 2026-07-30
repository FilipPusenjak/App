// buildSnapshot — the immutable input record stored on every evaluation.
//
// The snapshot is what the model sees AND what the history view replays later,
// so the mapping from database rows to snapshot must be stable: refs in order,
// enum values turned into human labels, dates flattened to YYYY-MM-DD, country
// codes turned into display names.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/evaluation/snapshot";

const profile = {
  gradeLevel: "Grade 11",
  schoolName: "Riverside High",
  schoolContext: "Offers 8 APs, no IB. Does not rank.",
  curriculum: "ib",
  gpa: 3.8,
  gpaScale: "4.0",
  intendedMajor: "Computer Science",
  careerGoal: "AI researcher",
  testScores: [
    {
      kind: "sat",
      label: "SAT",
      score: "1450",
      maxScore: "1600",
      predicted: false,
    },
  ],
  resumeItems: [
    {
      id: "item-a",
      type: "extracurricular",
      title: "Climbing",
      org: "Local gym",
      description: "Six years, competes regionally.",
      startDate: new Date("2020-09-01T12:00:00Z"),
      endDate: null,
      hoursPerWeek: 8,
      evidenceNotes: null,
    },
    {
      id: "item-b",
      type: "project",
      title: "Weather app",
      org: null,
      description: null,
      startDate: null,
      endDate: new Date("2025-06-15T12:00:00Z"),
      hoursPerWeek: null,
      evidenceNotes: "GitHub repo",
    },
  ],
  targetSchools: [
    {
      name: "MIT",
      country: "US",
      course: "Computer Science",
      classification: null,
      priority: 1,
      notes: null,
    },
    {
      name: "Cambridge",
      country: "GB",
      course: "Computer Science",
      classification: null,
      priority: null,
      notes: "Dream school",
    },
  ],
};

describe("buildSnapshot", () => {
  it("assigns stable short refs in resume-item order", () => {
    const snap = buildSnapshot(profile, "US");
    expect(snap.resumeItems.map((i) => i.ref)).toEqual(["R1", "R2"]);
    // The real row ids survive alongside the refs, so a saved evaluation can
    // still link to the live item.
    expect(snap.resumeItems.map((i) => i.id)).toEqual(["item-a", "item-b"]);
  });

  it("maps enum values to their display labels", () => {
    const snap = buildSnapshot(profile, "US");
    expect(snap.student.curriculum).toBe("IB");
    expect(snap.resumeItems[0]!.type).toBe("Extracurricular");
    expect(snap.resumeItems[1]!.type).toBe("Project");
  });

  it("flattens dates to YYYY-MM-DD (and null stays null)", () => {
    const snap = buildSnapshot(profile, "US");
    expect(snap.resumeItems[0]!.startDate).toBe("2020-09-01");
    expect(snap.resumeItems[0]!.endDate).toBeNull();
    expect(snap.resumeItems[1]!.endDate).toBe("2025-06-15");
  });

  it("keeps the target country code AND resolves its display name", () => {
    const snap = buildSnapshot(profile, "US");
    expect(snap.targets[0]).toMatchObject({
      country: "US",
      countryName: "United States",
    });
    expect(snap.targets[1]).toMatchObject({
      country: "GB",
      countryName: "United Kingdom",
    });
  });

  it("resolves the student's country of origin to a name, or null", () => {
    expect(buildSnapshot(profile, "US").student.countryOfOrigin).toBe(
      "United States",
    );
    expect(buildSnapshot(profile, null).student.countryOfOrigin).toBeNull();
  });

  it("records a capture timestamp", () => {
    const snap = buildSnapshot(profile, null);
    expect(new Date(snap.capturedAt).getTime()).not.toBeNaN();
  });
});
