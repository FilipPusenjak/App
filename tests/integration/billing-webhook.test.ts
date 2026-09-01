// Webhook delivery is at-least-once and unordered. This proves we survive both.
//
// These need a real database rather than a mock, because both properties being
// tested are properties of the WRITE: idempotency depends on a unique
// constraint actually rejecting the second insert, and the ordering guard
// depends on a row read back inside the same transaction. A mocked Prisma would
// happily confirm behaviour the database would never produce.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { applySubscriptionEvent } from "@/lib/billing/webhook";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("billing-hook");
const d = hasTestDb ? describe : describe.skip;

/** A subscription event shaped the way Stripe actually sends one. */
function event(over: {
  id: string;
  type: string;
  created: number;
  userId: string;
  customerId: string;
  subscriptionId: string;
  status?: string;
  planCode?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}): Stripe.Event {
  return {
    id: over.id,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: over.created,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: over.type,
    data: {
      object: {
        id: over.subscriptionId,
        object: "subscription",
        customer: over.customerId,
        status: over.status ?? "active",
        cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
        metadata: { userId: over.userId, planCode: over.planCode ?? "STUDENT_PLUS" },
        items: {
          object: "list",
          data: [
            {
              id: "si_test",
              object: "subscription_item",
              price: { id: "price_test", object: "price" },
              current_period_end: over.periodEnd ?? 1800000000,
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

d("applying Stripe subscription events", () => {
  let userId = "";
  let customerId = "";

  beforeEach(async () => {
    await cleanupRun(runTag);
    const made = await createUserWithProfile(runTag, "sub");
    userId = made.user.id;
    customerId = `cus_${runTag}`;
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
    await prisma.stripeEvent.deleteMany({
      where: { id: { startsWith: `evt_${runTag}` } },
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.stripeEvent.deleteMany({
      where: { id: { startsWith: `evt_${runTag}` } },
    });
    await cleanupRun(runTag);
  });

  it("writes the subscription the first time", async () => {
    const outcome = await applySubscriptionEvent(
      event({
        id: `evt_${runTag}_1`,
        type: "customer.subscription.created",
        created: 1_700_000_000,
        userId,
        customerId,
        subscriptionId: `sub_${runTag}`,
      }),
    );

    expect(outcome).toEqual({ applied: true, subscriptionId: `sub_${runTag}` });
    const row = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: `sub_${runTag}` },
    });
    expect(row?.planCode).toBe("STUDENT_PLUS");
    expect(row?.status).toBe("active");
    expect(row?.userId).toBe(userId);
  });

  it("applies the SAME event twice with one effect", async () => {
    // Stripe retries on any non-2xx and can redeliver regardless. Without the
    // dedup row this would apply twice; with it, the second is a no-op.
    const e = event({
      id: `evt_${runTag}_dup`,
      type: "customer.subscription.created",
      created: 1_700_000_000,
      userId,
      customerId,
      subscriptionId: `sub_${runTag}`,
    });

    const first = await applySubscriptionEvent(e);
    const second = await applySubscriptionEvent(e);

    expect(first.applied).toBe(true);
    expect(second).toEqual({ applied: false, reason: "duplicate" });
    expect(
      await prisma.subscription.count({
        where: { stripeSubscriptionId: `sub_${runTag}` },
      }),
    ).toBe(1);
  });

  it("refuses to let a late old event resurrect a cancelled plan", async () => {
    // THE ordering bug worth having a test for: a retried "updated" from before
    // the cancellation arriving after it would otherwise mark an unpaid
    // subscription active again.
    await applySubscriptionEvent(
      event({
        id: `evt_${runTag}_new`,
        type: "customer.subscription.deleted",
        created: 1_700_001_000,
        userId,
        customerId,
        subscriptionId: `sub_${runTag}`,
        status: "canceled",
      }),
    );

    const stale = await applySubscriptionEvent(
      event({
        id: `evt_${runTag}_old`,
        type: "customer.subscription.updated",
        created: 1_700_000_000, // earlier than the cancellation
        userId,
        customerId,
        subscriptionId: `sub_${runTag}`,
        status: "active",
      }),
    );

    expect(stale).toEqual({ applied: false, reason: "stale" });
    const row = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: `sub_${runTag}` },
    });
    expect(row?.status).toBe("canceled");

    // And the dropped event is still RECORDED, in the same breath. Dropping it
    // without recording it would leave Stripe retrying an event this app has
    // decided to ignore, forever. Asserted here rather than in its own test
    // because beforeEach clears these rows — it is one behaviour, not two.
    expect(
      await prisma.stripeEvent.findUnique({ where: { id: `evt_${runTag}_old` } }),
    ).not.toBeNull();
  });

  it("updates in place rather than accumulating rows per event", async () => {
    await applySubscriptionEvent(
      event({
        id: `evt_${runTag}_u1`,
        type: "customer.subscription.updated",
        created: 1_700_002_000,
        userId,
        customerId,
        subscriptionId: `sub_${runTag}`,
        status: "past_due",
      }),
    );

    const rows = await prisma.subscription.findMany({
      where: { stripeSubscriptionId: `sub_${runTag}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("past_due");
  });

  it("ignores an event it does not handle, without writing anything", async () => {
    const outcome = await applySubscriptionEvent(
      event({
        id: `evt_${runTag}_ignored`,
        type: "invoice.payment_succeeded",
        created: 1_700_003_000,
        userId,
        customerId,
        subscriptionId: `sub_${runTag}_other`,
      }),
    );
    expect(outcome).toEqual({ applied: false, reason: "unhandled" });
    expect(
      await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: `sub_${runTag}_other` },
      }),
    ).toBeNull();
  });

  it("refuses an event it cannot attribute to an account", async () => {
    // Better to drop it than to grant a plan to the wrong person.
    const orphan = event({
      id: `evt_${runTag}_orphan`,
      type: "customer.subscription.created",
      created: 1_700_004_000,
      userId: "",
      customerId: `cus_${runTag}_unknown`,
      subscriptionId: `sub_${runTag}_orphan`,
    });
    (orphan.data.object as { metadata: Record<string, string> }).metadata = {};

    expect(await applySubscriptionEvent(orphan)).toEqual({
      applied: false,
      reason: "unattributable",
    });
  });
});
