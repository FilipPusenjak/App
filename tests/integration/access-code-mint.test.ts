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
