// The terms page, and the two ways somebody reaches it.
//
// The failure a terms page actually has is not that it is missing — it is that
// it slowly stops describing the product. A retention window changes, an age
// floor moves, and the document quietly becomes a set of false statements made
// to customers who agreed to it. So the page IMPORTS the numbers it quotes, and
// these tests hold it that way rather than checking the prose.
//
// The other failure is a link nobody can follow: terms that exist at a URL with
// nothing pointing at it, or a footer pointing at a page that was never
// written. Both are checked here because both are silent.
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MINIMUM_AGE_YEARS } from "@/lib/validation/age";
import { FREE_RESULT_DAYS, PAID_RESULT_DAYS } from "@/lib/evaluation/retention";

const terms = readFileSync("app/terms/page.tsx", "utf8");
const footer = readFileSync("components/site-footer.tsx", "utf8");
const signup = readFileSync("app/(auth)/signup/signup-form.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

describe("the terms describe THIS product", () => {
  it("imports the numbers it quotes rather than typing them", () => {
    // The whole guarantee. A hardcoded "30 days" survives a change to
    // FREE_RESULT_DAYS and becomes a lie nobody notices.
    expect(terms).toMatch(/import \{ MINIMUM_AGE_YEARS \}/);
    expect(terms).toMatch(/FREE_RESULT_DAYS/);
    expect(terms).toMatch(/PAID_RESULT_DAYS/);
  });

  it("quotes no retention or age number as a literal", () => {
    // Belt and braces: the imports above are worth nothing if a literal was
    // also pasted into the prose beside them.
    const prose = terms.replace(/^import[\s\S]*?;$/gm, "");
    for (const n of [MINIMUM_AGE_YEARS, FREE_RESULT_DAYS, PAID_RESULT_DAYS]) {
      expect(prose, `${n} appears as a literal`).not.toMatch(
        new RegExp(`\\b${n}\\b(?![^<]*})`),
      );
    }
  });

  it("says the AI can be wrong, in those terms", () => {
    // The single most important sentence on the page for a product that gives
    // teenagers scored feedback about their futures.
    expect(terms).toMatch(/can be wrong/i);
    expect(terms).toMatch(/not a prediction|planning tool, not an admissions/i);
  });

  it("promises no admission probabilities, matching what the code enforces", () => {
    // lib/validation/counselor.ts refuses this phrasing in model output. The
    // terms would be contradicting the product if they did not say so.
    expect(terms).toMatch(/probabilit/i);
  });

  it("says scores outlive the prose, because that is what retention does", () => {
    expect(terms).toMatch(/scores are not deleted/i);
  });

  it("states the cancellation terms the billing page also states", () => {
    expect(terms).toMatch(/cancel/i);
    expect(terms).toMatch(/end of the period|already paid for/i);
  });

  it("is a public page with no session lookup", () => {
    // Somebody deciding whether to sign up has to read it first, and Stripe
    // needs it reachable.
    expect(terms).not.toMatch(/getCurrentUser|requireUserId|redirect\(/);
  });
});

describe("somebody can actually get to them", () => {
  it("links the terms from the footer", () => {
    expect(footer).toMatch(/href="\/terms"/);
  });

  it("renders the footer on every page, from the root layout", () => {
    expect(layout).toMatch(/<SiteFooter \/>/);
  });

  it("puts acceptance in front of somebody at the moment they sign up", () => {
    expect(signup).toMatch(/href="\/terms"/);
    expect(signup).toMatch(/agree to the/i);
  });

  it("links nothing from the footer that does not exist", () => {
    // A footer link to a 404 reads as a policy that was written and lost,
    // which is worse than an absent link. This is what stops the privacy link
    // going in before the page does.
    const hrefs = [...footer.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const route = `app${href}/page.tsx`;
      expect(existsSync(route), `${href} has no ${route}`).toBe(true);
    }
  });
});
