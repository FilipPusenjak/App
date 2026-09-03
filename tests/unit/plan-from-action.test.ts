// Turning a recommended action into a plan draft.
//
// The interesting part is what does NOT carry across. An evaluation gives
// prose about timing; a plan wants a calendar date. Bridging that gap by
// guessing would put a date on a student's plan that nothing actually said.
import { describe, expect, it } from "vitest";
import {
  comparableTitle,
  isEvaluationId,
  planDraftHref,
  planDraftParams,
  plannedActionTitles,
  type ActionLike,
} from "@/lib/plans/from-action";

const action: ActionLike = {
  title: "Enter the Senior Maths Challenge in October",
  detail: "Cambridge and Imperial both read subject olympiads as a signal.",
  timeframe: "This term",
};

describe("what carries into the plan", () => {
  it("carries the title and the reasoning", () => {
    const params = planDraftParams(action);
    expect(params.get("title")).toBe(action.title);
    expect(params.get("description")).toBe(action.detail);
  });

  it("carries the timeframe as CONTEXT, never as a date", () => {
    // "This term" is not a date, and converting it to one would be a guess
    // about this student's school year presented as though the evaluation
    // said it.
    const params = planDraftParams(action);
    expect(params.get("timeframe")).toBe("This term");
    expect(params.get("targetDate")).toBeNull();
  });

  it("never carries a type, because the model never states one", () => {
    expect(planDraftParams(action).get("type")).toBeNull();
  });

  it("survives the round trip through a URL", () => {
    const tricky: ActionLike = {
      title: "Ship the app & write it up (properly)",
      detail: "Use a repo — link it, don't just describe it. 100% done.",
      timeframe: "Next 3 months",
    };
    const href = planDraftHref(tricky);
    const parsed = new URL(href, "https://example.com").searchParams;
    expect(parsed.get("title")).toBe(tricky.title);
    expect(parsed.get("description")).toBe(tricky.detail);
  });

  it("points at the plan form", () => {
    expect(planDraftHref(action).startsWith("/plans/new?")).toBe(true);
  });

  it("omits empty fields rather than sending blanks", () => {
    const bare: ActionLike = { title: "Do a thing", detail: "", timeframe: "" };
    const params = planDraftParams(bare);
    expect(params.get("description")).toBeNull();
    expect(params.get("timeframe")).toBeNull();
  });
});

describe("getting back to the evaluation afterwards", () => {
  const EVAL_ID = "cmtkoz0be000eyf2byrh31hn5";

  it("carries the evaluation it was drafted from", () => {
    const href = planDraftHref(action, EVAL_ID);
    const parsed = new URL(href, "https://example.com").searchParams;
    expect(parsed.get("from")).toBe(EVAL_ID);
  });

  it("carries nothing when it was not drafted from one", () => {
    const parsed = new URL(planDraftHref(action), "https://example.com")
      .searchParams;
    expect(parsed.get("from")).toBeNull();
  });

  // The one that matters. This value reaches a redirect after a round trip
  // through a URL and a form field, so it is attacker-supplied by definition:
  // anyone can hand a student a /plans/new link with any `from` they like. It
  // is accepted as an ID and the path is built from it server-side, so none of
  // these can express a destination at all.
  it.each([
    ["an absolute URL", "https://evil.example.com/phish"],
    ["a protocol-relative URL", "//evil.example.com"],
    ["a path", "/settings/billing"],
    ["a path traversal", "../../etc/passwd"],
    ["a javascript URL", "javascript:alert(1)"],
    ["something with a slash in it", "abcdefghij0123456789/x"],
    ["an empty string", ""],
    ["too short to be an id", "abc123"],
    ["too long to be an id", "a".repeat(64)],
  ])("refuses %s", (_label, hostile) => {
    expect(isEvaluationId(hostile)).toBe(false);

    // And it never reaches the href either.
    const parsed = new URL(planDraftHref(action, hostile), "https://example.com")
      .searchParams;
    expect(parsed.get("from")).toBeNull();
  });

  it("accepts a real id", () => {
    expect(isEvaluationId(EVAL_ID)).toBe(true);
  });

  it("refuses undefined, which is what an absent parameter is", () => {
    expect(isEvaluationId(undefined)).toBe(false);
  });
});

describe("recognising an action already in the plan", () => {
  it("matches the same title back", () => {
    const planned = plannedActionTitles([action], [action.title]);
    expect(planned.has(action.title)).toBe(true);
  });

  it("survives the small edits people make when confirming a form", () => {
    // The student is invited to reword it, so a byte-exact comparison would
    // report almost everything as un-planned.
    const planned = plannedActionTitles(
      [action],
      ["  enter the senior maths challenge in OCTOBER!  "],
    );
    expect(planned.has(action.title)).toBe(true);
  });

  it("does not match a different action", () => {
    const planned = plannedActionTitles([action], ["Ship the co-op app"]);
    expect(planned.size).toBe(0);
  });

  it("handles a student with no plans at all", () => {
    expect(plannedActionTitles([action], []).size).toBe(0);
  });

  it("matches only the actions that are actually planned", () => {
    const other: ActionLike = { title: "Ship the app", detail: "d", timeframe: "t" };
    const planned = plannedActionTitles([action, other], [other.title]);
    expect(planned.has(other.title)).toBe(true);
    expect(planned.has(action.title)).toBe(false);
  });
});

describe("title comparison", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(comparableTitle("Enter the Maths Challenge!")).toBe(
      comparableTitle("  enter   the maths challenge  "),
    );
  });

  it("still tells genuinely different titles apart", () => {
    expect(comparableTitle("Enter the Maths Challenge")).not.toBe(
      comparableTitle("Enter the Physics Challenge"),
    );
  });

  it("does not collapse everything to the empty string", () => {
    // A normalizer that over-trims would mark every action as already planned.
    expect(comparableTitle("Ship the app").length).toBeGreaterThan(0);
  });
});
