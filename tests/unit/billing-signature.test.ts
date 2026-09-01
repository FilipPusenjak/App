// Webhook signature verification, exercised for real.
//
// This endpoint is unauthenticated by necessity — Stripe has no session here —
// so the signature is the ONLY thing standing between a stranger and the code
// that grants paid plans. A source-level test that the route calls
// constructEvent proves the call exists; this proves it actually rejects
// things, using the SDK's own signing so the check is the real one rather than
// a reimplementation of it.
import { describe, expect, it } from "vitest";
import Stripe from "stripe";

const SECRET = "whsec_test_secret_for_signature_checks";
const stripe = new Stripe("sk_test_not_used_for_local_signing", {
  apiVersion: "2026-08-26.dahlia",
});

const payload = JSON.stringify({
  id: "evt_test",
  object: "event",
  type: "customer.subscription.created",
  created: 1_700_000_000,
  data: { object: { id: "sub_test", object: "subscription" } },
});

function sign(body: string, secret = SECRET, timestamp?: number): string {
  return stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    ...(timestamp === undefined ? {} : { timestamp }),
  });
}

describe("a forged webhook cannot grant anybody anything", () => {
  it("accepts a genuinely signed payload", () => {
    const event = stripe.webhooks.constructEvent(payload, sign(payload), SECRET);
    expect(event.id).toBe("evt_test");
  });

  it("rejects a body altered after signing", () => {
    // The attack this exists to stop: take a real delivery, change the
    // subscription it points at, replay it.
    const header = sign(payload);
    const tampered = payload.replace("sub_test", "sub_attacker");
    expect(() =>
      stripe.webhooks.constructEvent(tampered, header, SECRET),
    ).toThrow();
  });

  it("rejects a payload signed with the wrong secret", () => {
    // A test-mode secret left on a live deployment, or somebody guessing.
    const header = sign(payload, "whsec_a_different_secret_entirely");
    expect(() => stripe.webhooks.constructEvent(payload, header, SECRET)).toThrow();
  });

  it("rejects an empty or malformed signature header", () => {
    for (const header of ["", "t=1,v1=deadbeef", "garbage"]) {
      expect(() =>
        stripe.webhooks.constructEvent(payload, header, SECRET),
      ).toThrow();
    }
  });

  it("rejects a replay of an old signature", () => {
    // Stripe's signature covers a timestamp, and constructEvent enforces a
    // tolerance. Without it a captured delivery could be replayed forever.
    const old = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
    const header = sign(payload, SECRET, old);
    expect(() =>
      stripe.webhooks.constructEvent(payload, header, SECRET, 300),
    ).toThrow();
  });
});
