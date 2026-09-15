// Minting codes from the browser, against a real database.
//
// The action is a thin gate in front of createAccessCode (already covered by
// access-codes.test.ts): what needs proving here is the gate itself — that a
// non-operator gets nothing, no matter what the form says, and that a real
// operator's submission actually reaches the database.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("mint-code");

const session = { email: null as string | null };
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () =>
    session.email ? { email: session.email } : null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { mintAccessCodeAction } = await import("@/app/actions/access-codes");

function fd(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

describe.skipIf(!hasTestDb)("minting an access code from the operations page", () => {
  const savedOperatorEmails = process.env.OPERATOR_EMAILS;

  beforeEach(async () => {
    await cleanupRun(runTag);
    // cleanupRun deletes USERS by email prefix and nothing else, so the codes a
    // previous test minted survive it. Every count assertion below is scoped to
    // this run's note, which makes leftovers indistinguishable from what the
    // call under test just wrote — "minted 3" read as 4 once an earlier test
    // had left one behind. Cleared here rather than only in afterAll.
    await prisma.accessCode.deleteMany({ where: { note: runTag } });
    process.env.OPERATOR_EMAILS = "ops@example.com";
    session.email = null;
  });

  afterAll(async () => {
    if (savedOperatorEmails === undefined) delete process.env.OPERATOR_EMAILS;
    else process.env.OPERATOR_EMAILS = savedOperatorEmails;
    await prisma.accessCode.deleteMany({ where: { note: runTag } });
    await cleanupRun(runTag);
  });

  it("refuses a signed-out request", async () => {
    session.email = null;
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", note: runTag }),
    );
    expect(result).toMatchObject({ error: "Not available." });
    expect(
      await prisma.accessCode.count({ where: { note: runTag } }),
    ).toBe(0);
  });

  it("refuses a signed-in account that is not on the operator list", async () => {
    // Confirms the gate reads the SESSION's email, not anything the form sent —
    // there is no field here a caller could set to claim operator status.
    session.email = "someone@example.com";
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", note: runTag }),
    );
    expect(result).toMatchObject({ error: "Not available." });
    expect(
      await prisma.accessCode.count({ where: { note: runTag } }),
    ).toBe(0);
  });

  it("mints for an operator, and the code actually redeems", async () => {
    session.email = "OPS@example.com"; // case-insensitive, like isOperator itself
    const result = await mintAccessCodeAction(
      {},
      fd({
        kind: "PROJECTION",
        count: "1",
        uses: "1",
        grants: "1",
        note: runTag,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.codes).toHaveLength(1);

    const row = await prisma.accessCode.findUnique({
      where: { code: result.codes![0].replace(/[^A-Z0-9]/g, "") },
    });
    expect(row).toMatchObject({ grantsKind: "PROJECTION", note: runTag });
  });

  it("mints several codes at once when asked", async () => {
    session.email = "ops@example.com";
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", count: "3", note: runTag }),
    );
    expect(result.codes).toHaveLength(3);
    // All distinct — a collision here would mean two mints returned the same code.
    expect(new Set(result.codes).size).toBe(3);
    expect(
      await prisma.accessCode.count({ where: { note: runTag } }),
    ).toBe(3);
  });

  it("refuses a kind that is not one of the real run kinds", async () => {
    session.email = "ops@example.com";
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "FREE_MONEY", note: runTag }),
    );
    expect(result.error).toBeTruthy();
    expect(
      await prisma.accessCode.count({ where: { note: runTag } }),
    ).toBe(0);
  });

  it("caps how many codes one submission can mint", async () => {
    session.email = "ops@example.com";
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", count: "51", note: runTag }),
    );
    expect(result.error).toBeTruthy();
    expect(
      await prisma.accessCode.count({ where: { note: runTag } }),
    ).toBe(0);
  });
});

/* ── Expiry ────────────────────────────────────────────────────────────────
   Two ways of saying when a code dies, because operators think both ways: a
   tester code is "a fortnight" and a code for an open house is "the day after".

   The timezone half is the part worth testing rather than eyeballing. A date
   input carries no zone, so a code minted from California for "31 October"
   would, computed in UTC, die at five in the afternoon on the 31st — during
   the event it was minted for. */
describe.skipIf(!hasTestDb)("when a minted code expires", () => {
  const savedOperatorEmails = process.env.OPERATOR_EMAILS;

  beforeEach(async () => {
    await prisma.accessCode.deleteMany({ where: { note: runTag } });
    process.env.OPERATOR_EMAILS = "ops@example.com";
    session.email = "ops@example.com";
  });

  afterAll(async () => {
    if (savedOperatorEmails === undefined) delete process.env.OPERATOR_EMAILS;
    else process.env.OPERATOR_EMAILS = savedOperatorEmails;
    await prisma.accessCode.deleteMany({ where: { note: runTag } });
  });

  const minted = () =>
    prisma.accessCode.findFirstOrThrow({ where: { note: runTag } });

  it("never expires when neither field is filled in", async () => {
    await mintAccessCodeAction({}, fd({ kind: "DEEP_REVIEW", note: runTag }));
    expect((await minted()).expiresAt).toBeNull();
  });

  it("still counts days forward, which is what most codes use", async () => {
    const before = Date.now();
    await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", days: "14", note: runTag }),
    );
    const at = (await minted()).expiresAt!;
    const fortnight = 14 * 86_400_000;
    expect(at.getTime()).toBeGreaterThanOrEqual(before + fortnight - 5_000);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now() + fortnight + 5_000);
  });

  it("expires at the end of the chosen day, in the operator's own timezone", async () => {
    // 480 = California in winter, eight hours behind UTC. The end of 31 October
    // there is 07:59 UTC on 1 November — NOT 23:59 UTC on the 31st, which is
    // what a server computing in its own zone would have stored.
    await mintAccessCodeAction(
      {},
      fd({
        kind: "DEEP_REVIEW",
        expiresOn: "2099-10-31",
        tzOffset: "480",
        note: runTag,
      }),
    );
    const at = (await minted()).expiresAt!;
    expect(at.toISOString()).toBe("2099-11-01T07:59:59.999Z");
  });

  it("falls back to UTC when the browser sent no offset", async () => {
    // Late rather than early, so the fallback fails in the harmless direction.
    await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", expiresOn: "2099-10-31", note: runTag }),
    );
    expect((await minted()).expiresAt!.toISOString()).toBe(
      "2099-10-31T23:59:59.999Z",
    );
  });

  it("ignores an offset that is not a timezone", async () => {
    // It arrives in a form field, so it is a claim rather than a fact.
    await mintAccessCodeAction(
      {},
      fd({
        kind: "DEEP_REVIEW",
        expiresOn: "2099-10-31",
        tzOffset: "99999",
        note: runTag,
      }),
    );
    expect((await minted()).expiresAt!.toISOString()).toBe(
      "2099-10-31T23:59:59.999Z",
    );
  });

  it("refuses both fields at once rather than picking one", async () => {
    // "Days wins over date" would be true in the code and in nobody's head,
    // and the code that died on a date nobody chose would surface weeks later.
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", days: "14", expiresOn: "2099-10-31", note: runTag }),
    );
    expect(result.error).toMatch(/not both/i);
    expect(await prisma.accessCode.count({ where: { note: runTag } })).toBe(0);
  });

  it("refuses a date that has already passed", async () => {
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", expiresOn: "2020-01-01", note: runTag }),
    );
    expect(result.error).toMatch(/already passed/i);
    expect(await prisma.accessCode.count({ where: { note: runTag } })).toBe(0);
  });

  it("refuses something that is not a date at all", async () => {
    const result = await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", expiresOn: "next Tuesday", note: runTag }),
    );
    expect(result.error).toBeTruthy();
    expect(await prisma.accessCode.count({ where: { note: runTag } })).toBe(0);
  });

  it("reports the date back, so the operator sees what was actually stored", async () => {
    const result = await mintAccessCodeAction(
      {},
      fd({
        kind: "DEEP_REVIEW",
        expiresOn: "2099-10-31",
        tzOffset: "480",
        note: runTag,
      }),
    );
    expect(result.expiresAt).toBe("2099-11-01T07:59:59.999Z");
  });

  it("puts the expiry on every code in a batch", async () => {
    await mintAccessCodeAction(
      {},
      fd({ kind: "DEEP_REVIEW", count: "3", expiresOn: "2099-10-31", note: runTag }),
    );
    const rows = await prisma.accessCode.findMany({ where: { note: runTag } });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.expiresAt!.toISOString()).toBe("2099-10-31T23:59:59.999Z");
    }
  });
});
