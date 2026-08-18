// No route may return after spending without recording what it spent.
//
// A source-level check, deliberately, because the property is about a route's
// SHAPE rather than its behaviour on any one input. The behavioural test
// (tests/integration/tier-failures.test.ts) proves the recorder works; nothing
// there would notice a future edit that adds a THIRD rejection path and
// returns early from it, which is exactly how this hole appeared the first
// time — the reject-and-return was added, and recording it was not.
//
// The rule: in the tier routes, every 502 that occurs after the model call
// must be preceded by a recordTierFailure. A silent one costs real money on
// the expensive model and leaves no trace in spend, history, or the bill.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = [
  "app/api/evaluations/deep-review/route.ts",
  "app/api/evaluations/check-in/route.ts",
];

describe("tier routes never spend without recording", () => {
  for (const path of ROUTES) {
    const source = readFileSync(path, "utf8");

    it(`${path} records before every 502`, () => {
      // Everything after the model call is post-spend.
      const callIndex = source.indexOf("client.messages.create");
      expect(callIndex).toBeGreaterThan(-1);
      const postSpend = source.slice(callIndex);

      const returns = postSpend.split("status: 502");
      // The first chunk precedes the first 502; each later chunk follows one.
      const rejections = returns.length - 1;
      expect(rejections).toBeGreaterThan(0);

      for (let i = 0; i < rejections; i += 1) {
        expect(
          returns[i]!.includes("recordTierFailure"),
          `A 502 in ${path} is not preceded by recordTierFailure. Every ` +
            `rejection after the model call has already cost money; returning ` +
            `without recording it hides that spend from the account total, ` +
            `from the student's history, and from anyone reading the bill.`,
        ).toBe(true);
      }
    });

    it(`${path} reads usage before it can reject`, () => {
      // The usage object has to be built before the first rejection, or the
      // recorder has nothing to record.
      const usageIndex = source.indexOf("cache_creation_input_tokens");
      const firstReject = source.indexOf("status: 502", source.indexOf("client.messages.create"));
      expect(usageIndex).toBeGreaterThan(-1);
      expect(firstReject).toBeGreaterThan(-1);
      expect(usageIndex).toBeLessThan(firstReject);
    });
  }
});
