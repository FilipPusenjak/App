// The research brief must describe the schema that actually exists.
//
// The brief is the only specification a researching agent ever sees. There is
// no human review between its output and what a 14-year-old reads, and a record
// that fails validation is not a partial loss — the whole course is discarded.
//
// So the brief drifting from the validator is not a documentation problem, it
// is a data-loss problem, and it is invisible until a batch comes back with
// rejections nobody can explain. v1 drifted exactly this way: the schema's
// limits moved and the prose did not, so it kept asking for records the
// validator had started refusing.
//
// These tests pin the two things that would drift: the worked example must
// still validate, and every numeric limit the brief quotes must still be the
// limit the code enforces.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRecord } from "@/lib/validation/course-requirements";
import { matchKey, isUsableKey } from "@/lib/requirements/match";
import { isValidCountryCode } from "@/lib/data/countries";

const BRIEF = "lib/prompts/research/course-requirements-v3.md";
const source = readFileSync(BRIEF, "utf8");

/**
 * The worked RECORD example.
 *
 * Selected by shape rather than by position: v3 added a second fenced json
 * block for the delivery envelope, and "the first block" would silently start
 * validating the wrong thing.
 */
function exampleRecord(): Record<string, unknown> {
  for (const match of source.matchAll(/```json\n([\s\S]*?)```/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && "requirements" in parsed) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error(`${BRIEF} has no fenced json record example`);
}

/** The delivery envelope example, which the ingest has to be able to read. */
function exampleEnvelope(): Record<string, unknown> {
  for (const match of source.matchAll(/```json\n([\s\S]*?)```/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && "records" in parsed) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error(`${BRIEF} has no fenced json envelope example`);
}

describe("the worked example the brief tells agents to copy", () => {
  it("passes the real validator", () => {
    const outcome = validateRecord(exampleRecord());
    if (!outcome.ok) {
      throw new Error(
        `The brief's own example is REJECTED by the ingest:\n  ` +
          outcome.errors.join("\n  ") +
          `\n\nAn agent copying it would lose every record it produced.`,
      );
    }
    expect(outcome.ok).toBe(true);
  });

  it("produces a usable match key", () => {
    const outcome = validateRecord(exampleRecord());
    if (!outcome.ok) throw new Error("unreachable");
    expect(isUsableKey(matchKey(outcome.record))).toBe(true);
  });

  it("uses a country code the app can actually match", () => {
    const outcome = validateRecord(exampleRecord());
    if (!outcome.ok) throw new Error("unreachable");
    // The failure this guards is silent: "UK" validates fine and then matches
    // nothing forever, because the app stores the United Kingdom as GB.
    expect(isValidCountryCode(outcome.record.country)).toBe(true);
  });

  it("keeps its acceptance rate rather than dropping it", () => {
    // If the example's rate is malformed the record still lands, so a broken
    // example would pass the test above while teaching the wrong shape.
    const outcome = validateRecord(exampleRecord());
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.droppedAcceptanceRate).toBe(false);
    expect(outcome.record.acceptanceRate).toBeTruthy();
  });
});

describe("the limits the brief quotes are the limits the code enforces", () => {
  // Each entry: a number printed in the brief, and a record that sits exactly
  // on the wrong side of it. If the schema moves, the brief is now lying to
  // every agent that reads it, and one of these flips.
  const base = () => exampleRecord() as Record<string, unknown>;

  it("rejects a quote below the 15 characters the brief states", () => {
    expect(source).toMatch(/at least 15 characters|\*\*15\*\* characters/);
    const record = base();
    (record.requirements as Record<string, { quote: string }>).gradeRequirement.quote =
      "Required.";
    expect(validateRecord(record).ok).toBe(false);
  });

  it("rejects a value above the 450 characters the brief states", () => {
    expect(source).toContain("450");
    const record = base();
    (record.requirements as Record<string, { value: string }>).gradeRequirement.value =
      "A".repeat(451);
    expect(validateRecord(record).ok).toBe(false);
  });

  it("accepts a value AT 450, which the brief calls generous on purpose", () => {
    const record = base();
    (record.requirements as Record<string, { value: string }>).gradeRequirement.value =
      "A".repeat(450);
    expect(validateRecord(record).ok).toBe(true);
  });

  it("rejects an omitted reason below the 10 characters the brief states", () => {
    expect(source).toMatch(/at least 10 characters|\*\*10\*\* characters/);
    const record = base();
    record.omitted = [{ field: "interview", reason: "not found" }]; // 9 chars
    expect(validateRecord(record).ok).toBe(false);
  });

  it("rejects a cycleYear outside the ±3 years the brief states", () => {
    expect(source).toMatch(/three years|±3/);
    const record = base();
    record.cycleYear = new Date().getUTCFullYear() + 4;
    expect(validateRecord(record).ok).toBe(false);
  });

  it("rejects http and the banned hosts the brief lists", () => {
    for (const url of [
      "http://www.cam.ac.uk/medicine",
      "https://www.thestudentroom.co.uk/x",
      "https://en.wikipedia.org/wiki/x",
    ]) {
      const record = base();
      (record.requirements as Record<string, { sourceUrl: string }>).gradeRequirement.sourceUrl = url;
      expect(validateRecord(record).ok, `${url} should be refused`).toBe(false);
      // And the brief must actually warn about it.
      const host = url.startsWith("http://") ? "https://" : new URL(url).hostname.replace(/^(www|en)\./, "");
      expect(source).toContain(host);
    }
  });
});

describe("the two rules that discard whole courses", () => {
  it("a partial fact sinks the entire record, as the brief warns", () => {
    expect(source).toMatch(/partial fact (destroys|sinks)/i);
    const record = exampleRecord() as Record<string, unknown>;
    const reqs = record.requirements as Record<string, unknown>;
    // A value and a URL but no quote — the shape an agent produces when it
    // knows the fact but could not find a quotable line.
    reqs.gradeRequirement = {
      value: "A*A*A at A Level",
      sourceUrl: "https://www.undergraduate.study.cam.ac.uk/courses/medicine",
    };
    const outcome = validateRecord(record);
    expect(outcome.ok).toBe(false);
    // Not merely the one field: the whole course is gone.
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.identifier).toContain("Cambridge");
  });

  it("an all-null record is rejected, as the brief warns", () => {
    expect(source).toMatch(/every field is null is rejected/i);
    const record = exampleRecord() as Record<string, unknown>;
    record.requirements = {
      gradeRequirement: null,
      requiredSubjects: null,
      admissionsTest: null,
      languageRequirement: null,
      interview: null,
      workExperience: null,
      restrictedEntry: null,
      applicationRoute: null,
    };
    expect(validateRecord(record).ok).toBe(false);
  });

  it("one sourced field is enough to survive", () => {
    // The other half of the rule: the brief tells agents that nulls are fine
    // as long as one field stands, and that has to be true.
    const record = exampleRecord() as Record<string, unknown>;
    const reqs = record.requirements as Record<string, unknown>;
    for (const f of [
      "requiredSubjects",
      "admissionsTest",
      "languageRequirement",
      "interview",
      "workExperience",
      "restrictedEntry",
      "applicationRoute",
    ]) {
      reqs[f] = null;
    }
    expect(validateRecord(record).ok).toBe(true);
  });
});

describe("v3's delivery envelope is one the ingest can actually read", () => {
  // The brief resolves an old contradiction by asking for a `records` envelope
  // alongside `noSourceableData`, `unmatchedCourses` and `unreached`. If the
  // ingest picked "the first array in the object" instead, a reordered envelope
  // would quietly ingest the wrong list — a small, confident, wrong batch.
  it("puts records first and carries the other lists", () => {
    const envelope = exampleEnvelope();
    expect(Object.keys(envelope)[0]).toBe("records");
    for (const key of ["noSourceableData", "unmatchedCourses", "unreached"]) {
      expect(Object.keys(envelope)).toContain(key);
    }
  });

  it("is read by the same precedence rule the ingest uses", () => {
    // Mirrors readRecords: a named `records` key wins over any other array,
    // whatever order the keys arrive in.
    const pick = (parsed: Record<string, unknown>) => {
      const named = parsed.records;
      if (Array.isArray(named)) return named;
      for (const value of Object.values(parsed)) {
        if (Array.isArray(value)) return value;
      }
      return null;
    };
    const envelope = exampleEnvelope();
    expect(pick(envelope)).toBe(envelope.records);
    // Reordered so another array comes first — still resolves to records.
    const reordered = {
      unreached: envelope.unreached,
      noSourceableData: envelope.noSourceableData,
      records: envelope.records,
    };
    expect(pick(reordered)).toBe(envelope.records);
  });
});

describe("v3 states the country list the validator really has", () => {
  it("lists only real codes, and enough of them to cover the EU targets", () => {
    const block = /```\n(AE[\s\S]*?)```/.exec(source)?.[1];
    expect(block, "brief has no country code block").toBeTruthy();
    const codes = block!.split(/\s+/).filter(Boolean);
    for (const code of codes) {
      expect(isValidCountryCode(code), `${code} is not a code the app knows`).toBe(true);
    }
    // Every country the brief's own EU section sends researchers to.
    for (const code of ["GB", "US", "DE", "NL", "FR", "IT", "ES", "SE", "DK", "BE", "CH"]) {
      expect(codes, `${code} missing from the brief's list`).toContain(code);
    }
  });

  it("warns that UK is stored and then matches nobody", () => {
    expect(isValidCountryCode("UK")).toBe(false);
    expect(source).toMatch(/`UK` is not on it/);
  });
});

describe("v3's quality floor", () => {
  it("names the five decision-relevant fields", () => {
    for (const field of [
      "gradeRequirement",
      "requiredSubjects",
      "admissionsTest",
      "languageRequirement",
      "restrictedEntry",
    ]) {
      expect(source).toContain(field);
    }
  });

  it("is a request, not a rejection — a route-only record still validates", () => {
    // Deliberate. 48% of the existing rows are route-only; enforcing the floor
    // in the validator would refuse them on a re-ingest and --prune would then
    // delete real data. The ingest reports the count instead.
    const record = exampleRecord();
    const reqs = record.requirements as Record<string, unknown>;
    for (const f of [
      "gradeRequirement",
      "requiredSubjects",
      "admissionsTest",
      "languageRequirement",
      "restrictedEntry",
      "interview",
      "workExperience",
    ]) {
      reqs[f] = null;
    }
    expect(validateRecord(record).ok).toBe(true);
  });
});
