// The billing promises, and the source that has to keep them.
//
// Money makes two opposite mistakes expensive. Granting something nobody paid
// for costs revenue; refusing something somebody DID pay for costs a customer
// and is the one they will remember. Most of these tests are about the second.
//
// Source-level where the claim is architectural — "the webhook is the only
// thing that grants a plan", "no page shows a dead checkout button" — because a
// behavioural test only proves the paths it happened to call behaved today,
// and these claims are about what the code cannot do.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_STATUSES,
  DEAD_STATUSES,
  bandStanding,
  effectivePlan,
  planMayGate,
  subscriptionGrantsAccess,
  type SubscriptionState,
} from "@/lib/billing/entitlement";
import {
  PLANS,
  STUDENT_FREE,
  STUDENT_PLUS,
  TUTOR_20,
  TUTOR_50,
  planByCode,
  plansFor,
} from "@/lib/billing/plans";
import { CASELOAD_BANDS } from "@/lib/testprep/entitlement";
import { HANDLED_EVENTS } from "@/lib/billing/webhook";

const ROOT = process.cwd();

/** Source with comments stripped, so prose about a rule cannot satisfy it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NOW = new Date("2026-06-15T12:00:00Z");
const LATER = new Date("2026-07-15T12:00:00Z");

function sub(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    planCode: "STUDENT_PLUS",
    status: "active",
    currentPeriodEnd: LATER,
    cancelAtPeriodEnd: false,
    ...over,
  };
}

describe("paid-for time is honoured to the end", () => {
  /**
   * The rule that stops the app evicting somebody who paid. Stripe sets status
   * to canceled the MOMENT a customer cancels, not when their month runs out —
   * so treating that status as immediate takes away time they bought.
   */
  it("keeps a cancelled subscription until its period actually ends", () => {
    expect(
      subscriptionGrantsAccess(
        sub({ status: "canceled", currentPeriodEnd: LATER }),
        NOW,
      ),
    ).toBe(true);
  });

  it("lets it go once the period has passed", () => {
    expect(
      subscriptionGrantsAccess(
        sub({ status: "canceled", currentPeriodEnd: NOW }),
        LATER,
      ),
    ).toBe(false);
  });

  it("keeps a past_due subscription alive for the period already paid for", () => {
    // Overwhelmingly this is an expired card, and the fix takes a few days.
    // Being wrong here costs one month; being wrong the other way locks out a
    // paying customer over a card number.
    expect(
      subscriptionGrantsAccess(sub({ status: "past_due" }), NOW),
    ).toBe(true);
  });

  it("treats a trial as the plan, because that is what a trial is for", () => {
    expect(subscriptionGrantsAccess(sub({ status: "trialing" }), NOW)).toBe(true);
  });

  it("refuses a dead subscription with no runway left", () => {
    for (const status of DEAD_STATUSES) {
      expect({
        status,
        granted: subscriptionGrantsAccess(
          sub({ status, currentPeriodEnd: null }),
          NOW,
        ),
      }).toEqual({ status, granted: false });
    }
  });

  it("grants every status it calls current", () => {
    for (const status of CURRENT_STATUSES) {
      expect({
        status,
        granted: subscriptionGrantsAccess(
          sub({ status, currentPeriodEnd: null }),
          NOW,
        ),
      }).toEqual({ status, granted: true });
    }
  });
});

describe("a lapse never takes away what somebody already has", () => {
  /**
   * THE promise of this billing system, and the one most likely to be quietly
   * broken by a later change that adds "just one more" paywall. A student's own
   * record is theirs; a card that expired does not make it ours.
   */
  it("gates only new expensive runs, and nothing else", () => {
    expect(planMayGate("NEW_EXPENSIVE_RUN")).toBe(true);
    for (const kind of [
      "EXISTING_EVALUATION",
      "OWN_PROFILE_DATA",
      "STOPPING_SIGNAL",
      "EXPORT_OWN_DATA",
    ] as const) {
      expect({ kind, gated: planMayGate(kind) }).toEqual({ kind, gated: false });
    }
  });

  it("drops a lapsed account to the free plan rather than to nothing", () => {
    const plan = effectivePlan(
      [sub({ status: "canceled", currentPeriodEnd: NOW })],
      "STUDENT",
      LATER,
    );
    // A real plan, not null — the account keeps a plan to fall back to rather
    // than being left in an unrepresented state.
    expect(plan).toEqual(STUDENT_FREE);
  });

  it("says so on the billing page, where a customer can read it", () => {
    // A promise that lives only in a code comment is not a promise.
    const page = readFileSync(
      join(ROOT, "app", "(app)", "settings", "billing", "page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/already run stays readable/i);
    expect(page).toMatch(/never hidden behind a payment|export/i);
    expect(page).toMatch(/[Nn]othing is deleted/);
  });
});

describe("the effective plan is the most generous one in force", () => {
  it("prefers a live paid plan over the free fallback", () => {
    expect(effectivePlan([sub()], "STUDENT", NOW)).toEqual(STUDENT_PLUS);
  });

  it("ignores a plan belonging to the other surface", () => {
    // A tutor band must not raise a student's model budget, and vice versa.
    expect(effectivePlan([sub({ planCode: "TUTOR_50" })], "STUDENT", NOW)).toEqual(
      STUDENT_FREE,
    );
    expect(effectivePlan([sub({ planCode: "STUDENT_PLUS" })], "TUTOR", NOW)).toBeNull();
  });

  it("gives a tutor with no band no plan at all, rather than inventing one", () => {
    expect(effectivePlan([], "TUTOR", NOW)).toBeNull();
  });

  it("picks the larger band when two are briefly live during an upgrade", () => {
    const plan = effectivePlan(
      [sub({ planCode: "TUTOR_20" }), sub({ planCode: "TUTOR_50" })],
      "TUTOR",
      NOW,
    );
    expect(plan?.code).toBe("TUTOR_50");
  });
});

describe("the tutor's bands stay soft", () => {
  /**
   * Carried over from lib/testprep/entitlement.ts, because billing arriving in
   * the codebase is precisely the moment soft enforcement gets quietly turned
   * into a gate.
   */
  it("returns a message and nothing a caller could wire to a disabled button", () => {
    const standing = bandStanding({
      active: 23,
      limit: 20,
      suggestedName: "The 50-student plan",
    });
    expect(standing.overBand).toBe(true);
    expect(standing.message).toContain("23");
    expect(standing.message).toMatch(/[Nn]othing is limited/);
    // The shape itself is the guarantee: no `blocked`, no `disabled`, no
    // `redirectTo`. A field like that would be used during a live session.
    expect(Object.keys(standing).sort()).toEqual([
      "active",
      "limit",
      "message",
      "overBand",
    ]);
  });

  it("says nothing at all when inside the band", () => {
    expect(bandStanding({ active: 5, limit: 20, suggestedName: null })).toEqual({
      active: 5,
      limit: 20,
      overBand: false,
      message: null,
    });
  });

  it("never auto-selects a band, even over the largest one", () => {
    const src = code(join(ROOT, "lib", "billing", "entitlement.ts"));
    // No write, no checkout call, no plan assignment anywhere in the rules.
    expect(src).not.toMatch(/prisma\./);
    expect(src).not.toMatch(/checkout|stripe/i);
  });

  it("keeps the stopping signal ungated after billing exists", () => {
    // The load-bearing promise of the test-prep product. An over-band, unpaid,
    // expired account is still told when to stop.
    const stopping = code(join(ROOT, "lib", "testprep", "stopping.ts"));
    expect(stopping).not.toMatch(/subscription|entitlement|billing|stripe/i);
  });
});

describe("the plan catalogue and the bands cannot drift apart", () => {
  it("sells exactly the bands the test-prep engine knows about", () => {
    const sold = plansFor("TUTOR")
      .map((p) => p.caseloadLimit)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    const known = CASELOAD_BANDS.map((b) => b.students).sort((a, b) => a - b);
    expect(sold).toEqual(known);
  });

  it("uses the same plan codes on both sides", () => {
    for (const band of CASELOAD_BANDS) {
      expect({ code: band.code, known: planByCode(band.code) !== null }).toEqual({
        code: band.code,
        known: true,
      });
    }
  });

  it("gives every purchasable plan a price id to look up", () => {
    // A plan with no price env var can never be bought, and would render a
    // button that 400s. The free plan is the deliberate exception.
    for (const plan of PLANS) {
      const purchasable = plan.monthlyUsd > 0;
      expect({ code: plan.code, ok: purchasable === (plan.stripePriceIdEnv !== "") }).toEqual(
        { code: plan.code, ok: true },
      );
    }
  });

  it("has a free student plan, so 'what am I on' always has an answer", () => {
    expect(STUDENT_FREE.monthlyUsd).toBe(0);
  });

  it("prices the paid student plan above the free one", () => {
    // What paying actually buys is now the quota gap — see quota.test.ts,
    // "gives the free tier strictly less of everything" — not a spend ceiling.
    expect(STUDENT_PLUS.monthlyUsd).toBeGreaterThan(STUDENT_FREE.monthlyUsd);
    expect(TUTOR_50.caseloadLimit!).toBeGreaterThan(TUTOR_20.caseloadLimit!);
  });
});

describe("only the webhook grants a plan", () => {
  /**
   * The classic way a subscription app gives its product away is trusting the
   * checkout success redirect. A success URL is a redirect the customer's
   * browser follows and anybody can type; only the webhook carries a signature.
   */
  it("writes no subscription from the checkout route", () => {
    const src = code(join(ROOT, "app", "api", "billing", "checkout", "route.ts"));
    expect(src).not.toMatch(/prisma\.subscription\./);
  });

  it("verifies the signature before believing the body", () => {
    const src = code(join(ROOT, "app", "api", "billing", "webhook", "route.ts"));
    expect(src).toMatch(/constructEvent/);
    // The RAW body. Parsing first and re-serialising breaks verification for
    // entirely valid requests.
    expect(src).toMatch(/request\.text\(\)/);
    expect(src).not.toMatch(/request\.json\(\)/);
  });

  it("refuses a request carrying no signature at all", () => {
    const src = code(join(ROOT, "app", "api", "billing", "webhook", "route.ts"));
    expect(src).toMatch(/stripe-signature/);
    expect(src).toMatch(/status:\s*400/);
  });

  it("acts only on subscription lifecycle events", () => {
    expect([...HANDLED_EVENTS]).toEqual([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
  });

  it("deduplicates and orders, in the same transaction as the effect", () => {
    const src = code(join(ROOT, "lib", "billing", "webhook.ts"));
    // The dedup row and the subscription write share one transaction, so a
    // crash between them cannot record an effect that did not happen.
    expect(src).toMatch(/\$transaction/);
    expect(src).toMatch(/stripeEvent\.create/);
    // And a late-arriving older event cannot resurrect a cancelled plan.
    expect(src).toMatch(/lastEventAt/);
  });
});

describe("the app works with no Stripe account at all", () => {
  /**
   * This deployment, CI, every test, and any instance whose owner has not set
   * billing up. An unconfigured app must behave exactly as it did before
   * billing existed — not crash, and not show buttons that throw.
   */
  it("constructs no Stripe client at import time", async () => {
    // A module-level `new Stripe(...)` would throw on import and take down
    // every page that transitively imports anything billing-related.
    const src = code(join(ROOT, "lib", "billing", "stripe.ts"));
    expect(src).not.toMatch(/^const \w+ = new Stripe/m);

    const mod = await import("@/lib/billing/stripe");
    expect(mod.isStripeConfigured()).toBe(false);
    expect(mod.getStripe()).toBeNull();
  });

  it("hides checkout rather than rendering a button that throws", () => {
    for (const page of [
      join(ROOT, "app", "(app)", "settings", "billing", "page.tsx"),
      join(ROOT, "app", "(tutor)", "students-testprep", "plan", "page.tsx"),
    ]) {
      const src = code(page);
      // Every checkout button is behind a configured check.
      expect({ page, guarded: /isStripeConfigured|stripeReady|configured/.test(src) }).toEqual(
        { page, guarded: true },
      );
    }
  });

  it("refuses checkout with a clear status rather than a stack trace", () => {
    const src = code(join(ROOT, "app", "api", "billing", "checkout", "route.ts"));
    expect(src).toMatch(/isStripeConfigured/);
    expect(src).toMatch(/status:\s*503/);
  });
});
