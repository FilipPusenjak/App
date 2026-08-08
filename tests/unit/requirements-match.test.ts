// Matching a student's typed target to a researched course record.
//
// The governing rule: a WRONG match is far worse than NO match. No match means
// the evaluation behaves exactly as it does today — "check the official course
// page" — which is safe. A wrong match shows a student one university's
// requirements under another's name, sourced and dated and looking
// authoritative. Every test here is about that asymmetry.
import { describe, expect, it } from "vitest";
import { isUsableKey, matchKey, normalizeName } from "@/lib/requirements/match";

const key = (university: string, country: string, course: string) =>
  matchKey({ university, country, course });

describe("normalizing a name", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeName("St. Andrews")).toBe(normalizeName("st andrews"));
    expect(normalizeName("King's  College")).toBe(normalizeName("Kings College"));
  });

  it("ignores accents, so a student without the keyboard still matches", () => {
    expect(normalizeName("Universität Heidelberg")).toBe(
      normalizeName("Universitat Heidelberg"),
    );
  });

  it("drops only words that genuinely identify nothing", () => {
    expect(normalizeName("The University of Cambridge")).toBe(
      normalizeName("University Cambridge"),
    );
  });

  it("KEEPS 'university' and 'college', which are load-bearing in real names", () => {
    // Dropping them was the first version, and it merged University College
    // London with London. A shorter key is not worth a wrong one.
    expect(normalizeName("University College London")).not.toBe(
      normalizeName("London"),
    );
    expect(normalizeName("Imperial College London")).not.toBe(
      normalizeName("London"),
    );
  });
});

describe("what must NOT match", () => {
  it("keeps two universities in different countries apart", () => {
    // Trinity College exists in Dublin and in Cambridge, with entirely
    // different medicine requirements. This is the collision that would do
    // real damage.
    expect(key("Trinity College", "IE", "Medicine")).not.toBe(
      key("Trinity College", "GB", "Medicine"),
    );
  });

  it("keeps two courses at the same university apart", () => {
    expect(key("Cambridge", "GB", "Medicine")).not.toBe(
      key("Cambridge", "GB", "Dentistry"),
    );
  });

  it("does not let a dropped noise word merge distinct institutions", () => {
    // "Technical University of Munich" is not "University of Munich". If the
    // noise list ever grows to swallow "technical", this fails.
    expect(key("Technical University of Munich", "DE", "Physics")).not.toBe(
      key("University of Munich", "DE", "Physics"),
    );
  });

  it("does not match on a shared prefix", () => {
    // No fuzzy or partial matching anywhere: "London" must not reach
    // "University College London".
    expect(key("London", "GB", "Law")).not.toBe(
      key("University College London", "GB", "Law"),
    );
  });
});

describe("what must match", () => {
  it("matches the same name written with different case and punctuation", () => {
    expect(key("University of Cambridge", "GB", "Medicine (A100)")).toBe(
      key("the university of cambridge", "gb", "medicine a100"),
    );
  });

  it("does NOT match a shortened name — a miss, which is the safe failure", () => {
    // Accepted cost of keeping "university" significant. The student simply
    // gets today's behaviour: "check the official course page". Closing this
    // needs an alias table, not looser normalization.
    expect(key("Cambridge", "GB", "Medicine")).not.toBe(
      key("University of Cambridge", "GB", "Medicine"),
    );
  });

  it("is stable across repeated calls", () => {
    // A key that varied between runs would silently orphan stored rows.
    const first = key("Utrecht University", "NL", "Liberal Arts and Sciences");
    for (let i = 0; i < 20; i++) {
      expect(key("Utrecht University", "NL", "Liberal Arts and Sciences")).toBe(
        first,
      );
    }
  });
});

describe("unusable keys", () => {
  it("rejects a name made entirely of noise words", () => {
    // "The" alone identifies nothing and would collide with every other
    // vague entry.
    expect(isUsableKey(key("The", "GB", "Medicine"))).toBe(false);
  });

  it("rejects a blank course", () => {
    expect(isUsableKey(key("Cambridge", "GB", ""))).toBe(false);
  });

  it("accepts a normal pair", () => {
    expect(isUsableKey(key("Cambridge", "GB", "Medicine"))).toBe(true);
  });
});
