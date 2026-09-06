// "I'll do this" putting the thing in the plan — against a real database,
// because the whole change is two tables staying in step.
//
// The rules are pure and covered in tests/unit. What cannot be tested there is
// what this route actually WRITES: that accepting creates a plan item, that
// pressing twice does not create two, that resolving takes it back out, and
// that none of it can reach an item the student typed themselves.
//
// Confirmed broken on the deployment before this existed: one student with
// three accepted commitments and an empty Plans page.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("commit-plan");

const session = { userId: null as string | null };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => {
    if (!session.userId) throw new Error("not signed in");
    return session.userId;
  },
}));

const { PATCH } = await import("@/app/api/commitments/[id]/route");

/** Drive the route the way the button does. */
async function move(id: string, status: string) {
  const res = await PATCH(
    new Request(`http://test/api/commitments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

async function commitmentFor(profileId: string, description = "Join debate") {
  return prisma.commitment.create({
    data: { profileId, description, status: "PROPOSED" },
  });
}

const planFor = (commitmentId: string) =>
  prisma.plannedItem.findFirst({ where: { sourceCommitmentId: commitmentId } });

describe.skipIf(!hasTestDb)("accepting a commitment puts it in the plan", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("creates a plan item the student can see", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "accept");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id, "Read three papers");

    const res = await move(commitment.id, "ACCEPTED");
    expect(res.status).toBe(200);

    const item = await planFor(commitment.id);
    expect(item?.title).toBe("Read three papers");
    expect(item?.profileId).toBe(profile.id);
  });

  it("does not create a second one when pressed twice", async () => {
    // A double click, or a retried request. The unique index makes a plain
    // create throw here, which would 500 a request that had already worked.
    const { user, profile } = await createUserWithProfile(runTag, "twice");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    // ACCEPTED -> ACCEPTED is refused by the transition table, so go the long
    // way round: the second write reaches the plan through IN_PROGRESS.
    await move(commitment.id, "IN_PROGRESS");

    const items = await prisma.plannedItem.findMany({
      where: { sourceCommitmentId: commitment.id },
    });
    expect(items).toHaveLength(1);
  });

  it("keeps it while the work is under way", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "started");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    await move(commitment.id, "IN_PROGRESS");
    expect(await planFor(commitment.id)).not.toBeNull();
  });

  it("takes it out when the student sets it aside", async () => {
    // The mirror of the button that put it there. Leaving it would have the
    // projection go on pricing work they have said they are not doing.
    const { user, profile } = await createUserWithProfile(runTag, "aside");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    expect(await planFor(commitment.id)).not.toBeNull();

    await move(commitment.id, "ABANDONED");
    expect(await planFor(commitment.id)).toBeNull();
  });

  it("takes it out when it is done", async () => {
    // Still in the Commitment table with its history; just no longer PLANNED.
    const { user, profile } = await createUserWithProfile(runTag, "done");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    await move(commitment.id, "COMPLETED");

    expect(await planFor(commitment.id)).toBeNull();
    const row = await prisma.commitment.findUniqueOrThrow({
      where: { id: commitment.id },
    });
    expect(row.status).toBe("COMPLETED");
    expect(row.resolvedAt).not.toBeNull();
  });

  it("declining a proposal outright writes no plan item", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "declined");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    const res = await move(commitment.id, "ABANDONED");
    expect(res.status).toBe(200);
    expect(await planFor(commitment.id)).toBeNull();
  });

  it("never touches an item the student typed themselves", async () => {
    // Everything hand-written has a null sourceCommitmentId. Nothing in this
    // route may reach it, whatever happens to the commitment.
    const { user, profile } = await createUserWithProfile(runTag, "handmade");
    session.userId = user.id;
    const mine = await prisma.plannedItem.create({
      data: { profileId: profile.id, type: "project", title: "My own plan" },
    });
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    await move(commitment.id, "ABANDONED");

    expect(
      await prisma.plannedItem.findUnique({ where: { id: mine.id } }),
    ).not.toBeNull();
  });

  it("leaves a plan item alone once the student has edited it", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "edited");
    session.userId = user.id;
    const commitment = await commitmentFor(profile.id);

    await move(commitment.id, "ACCEPTED");
    const item = await planFor(commitment.id);
    await prisma.plannedItem.update({
      where: { id: item!.id },
      data: { title: "Reworded by me", hoursPerWeek: 3 },
    });

    // A second write through the plan (ACCEPTED -> IN_PROGRESS) must not
    // re-derive over the top of their edit.
    await move(commitment.id, "IN_PROGRESS");
    const after = await planFor(commitment.id);
    expect(after?.title).toBe("Reworded by me");
    expect(after?.hoursPerWeek).toBe(3);
  });

  it("cannot be driven against somebody else's commitment", async () => {
    const owner = await createUserWithProfile(runTag, "owner");
    const stranger = await createUserWithProfile(runTag, "stranger");
    const commitment = await commitmentFor(owner.profile.id);

    session.userId = stranger.user.id;
    const res = await move(commitment.id, "ACCEPTED");

    expect(res.status).toBe(404);
    expect(await planFor(commitment.id)).toBeNull();
  });
});
