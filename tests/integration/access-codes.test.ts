// Codes and credits, against a real database.
//
// Every guarantee here is enforced by a database constraint rather than by an
// if-statement: "once per account" is a unique index, and "cannot go negative"
// is a conditional update. Neither can be tested with a mock, because a mock
// would confirm the check the application THINKS it is making rather than the
// one Postgres actually enforces under two simultaneous requests.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  consumeCredit,
  createAccessCode,
  creditsFor,
  redeemCode,
} from "@/lib/billing/codes";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("codes");
const d = hasTestDb ? describe : describe.skip;

d("redeeming a code", () => {
  let userId = "";
  let otherUserId = "";
  const madeCodes: string[] = [];

  beforeEach(async () => {
    await cleanupRun(runTag);
    const a = await createUserWithProfile(runTag, "redeemer");
    const b = await createUserWithProfile(runTag, "other");
    userId = a.user.id;
    otherUserId = b.user.id;
  });

  afterAll(async () => {
    await prisma.accessCode.deleteMany({ where: { note: runTag } });
    await cleanupRun(runTag);
  });

  async function mint(over: Parameters<typeof createAccessCode>[0]) {
    const made = await createAccessCode({ ...over, note: runTag });
    madeCodes.push(made.code);
    return made;
  }

  it("grants a credit for the right kind", async () => {
    const { code } = await mint({ kind: "DEEP_REVIEW" });

    const result = await redeemCode({ userId, code });
    expect(result).toMatchObject({ ok: true, kind: "DEEP_REVIEW", granted: 1 });

    const credits = await creditsFor(userId);
    expect(credits.DEEP_REVIEW).toBe(1);
    // And nothing leaked into the other kinds.
    expect(credits.PROJECTION).toBe(0);
    expect(credits.CHECK_IN).toBe(0);
  });

  it("refuses the same code twice from one account", async () => {
    const { code } = await mint({ kind: "PROJECTION" });

    expect((await redeemCode({ userId, code })).ok).toBe(true);
    const second = await redeemCode({ userId, code });

    expect(second).toMatchObject({ ok: false, reason: "already-redeemed" });
    // Crucially, the second attempt granted nothing.
    expect((await creditsFor(userId)).PROJECTION).toBe(1);
  });

  it("lets a multi-use code be redeemed by different accounts", async () => {
    const { code } = await mint({ kind: "DEEP_REVIEW", maxRedemptions: 2 });

    expect((await redeemCode({ userId, code })).ok).toBe(true);
    expect((await redeemCode({ userId: otherUserId, code })).ok).toBe(true);

    expect((await creditsFor(userId)).DEEP_REVIEW).toBe(1);
    expect((await creditsFor(otherUserId)).DEEP_REVIEW).toBe(1);
  });

  it("stops once the redemption limit is reached", async () => {
    const { code } = await mint({ kind: "DEEP_REVIEW", maxRedemptions: 1 });
    await redeemCode({ userId, code });

    const third = await redeemCode({ userId: otherUserId, code });
    expect(third).toMatchObject({ ok: false, reason: "exhausted" });
    expect((await creditsFor(otherUserId)).DEEP_REVIEW).toBe(0);
  });

  it("refuses an expired code", async () => {
    const { code } = await mint({
      kind: "DEEP_REVIEW",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await redeemCode({ userId, code })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("says the same thing about an unknown code as a malformed one", async () => {
    // A prober should not be able to tell which codes exist.
    const unknown = await redeemCode({ userId, code: "CHART-ZZZZ-ZZZZ" });
    const nonsense = await redeemCode({ userId, code: "not a code at all" });
    expect(unknown).toMatchObject({ ok: false, reason: "not-found" });
    expect(nonsense).toMatchObject({ ok: false, reason: "not-found" });
    if (!unknown.ok && !nonsense.ok) {
      expect(unknown.message).toBe(nonsense.message);
    }
  });

  it("accepts a code however it was typed back", async () => {
    const { code } = await mint({ kind: "CHECK_IN" });
    const messy = `  ${code.toLowerCase().replace(/-/g, " ")}  `;
    expect((await redeemCode({ userId, code: messy })).ok).toBe(true);
  });

  it("adds up when one account redeems several codes", async () => {
    const a = await mint({ kind: "DEEP_REVIEW" });
    const b = await mint({ kind: "DEEP_REVIEW", grantsCount: 2 });

    await redeemCode({ userId, code: a.code });
    await redeemCode({ userId, code: b.code });

    expect((await creditsFor(userId)).DEEP_REVIEW).toBe(3);
  });
});

d("spending a credit", () => {
  let userId = "";
  const tag = makeRunTag("credits");

  beforeEach(async () => {
    await cleanupRun(tag);
    const made = await createUserWithProfile(tag, "spender");
    userId = made.user.id;
  });

  afterAll(async () => {
    await cleanupRun(tag);
  });

  it("decrements, and reports whether it actually spent one", async () => {
    await prisma.runCredit.create({
      data: { userId, kind: "DEEP_REVIEW", remaining: 1 },
    });

    expect(await consumeCredit(userId, "DEEP_REVIEW")).toBe(true);
    expect((await creditsFor(userId)).DEEP_REVIEW).toBe(0);

    // Nothing left: reports false rather than going negative.
    expect(await consumeCredit(userId, "DEEP_REVIEW")).toBe(false);
    expect((await creditsFor(userId)).DEEP_REVIEW).toBe(0);
  });

  it("cannot be driven below zero by simultaneous runs", async () => {
    // THE concurrency case. Two requests race for the last credit; the
    // conditional update means exactly one wins, because the loser matches no
    // row rather than reading a stale count.
    await prisma.runCredit.create({
      data: { userId, kind: "PROJECTION", remaining: 1 },
    });

    const results = await Promise.all([
      consumeCredit(userId, "PROJECTION"),
      consumeCredit(userId, "PROJECTION"),
      consumeCredit(userId, "PROJECTION"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await creditsFor(userId)).PROJECTION).toBe(0);
  });

  it("reports zero for an account that has never redeemed anything", async () => {
    expect(await creditsFor(userId)).toEqual({
      DEEP_REVIEW: 0,
      PROJECTION: 0,
      CHECK_IN: 0,
    });
  });
});
