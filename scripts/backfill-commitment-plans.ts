// Put already-accepted commitments into the plans they should have been in.
//
//   DATABASE_URL="<prod>" npx tsx scripts/backfill-commitment-plans.ts
//   DATABASE_URL="<prod>" npx tsx scripts/backfill-commitment-plans.ts --write
//
// Dry run by default. Nothing is written until --write.
//
// WHY THIS EXISTS. Accepting a commitment did not create a plan item — the bug
// this backfills after. Fixing the route only helps the next person to press
// the button; every student who already pressed it is left with a commitment
// marked accepted and a Plans page that does not mention it, which is the
// symptom they reported in the first place.
//
// It is deliberately a script rather than a migration. A schema migration runs
// itself on deploy; this creates rows in real students' accounts, and that
// should be somebody's decision rather than a side effect of shipping.
//
// SAFE TO RUN TWICE. Every write is an upsert keyed on sourceCommitmentId, the
// same unique key the route uses, so a second run changes nothing. It never
// touches a plan item a student typed themselves — those have a null
// sourceCommitmentId and are not addressable by this at all.
import { plannedItemFromCommitment, shouldBeInPlan } from "../lib/plans/from-commitment";
import { prisma } from "../lib/db";

async function main() {
  const write = process.argv.includes("--write");

  // Only the live ones. A commitment already completed or abandoned is not
  // planned, and backfilling it would put work somebody has finished or
  // dropped back into the projection.
  const commitments = await prisma.commitment.findMany({
    where: { status: { in: ["ACCEPTED", "IN_PROGRESS"] } },
    select: {
      id: true,
      profileId: true,
      description: true,
      dueDate: true,
      status: true,
      profile: { select: { user: { select: { email: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const existing = await prisma.plannedItem.findMany({
    where: { sourceCommitmentId: { in: commitments.map((c) => c.id) } },
    select: { sourceCommitmentId: true },
  });
  const alreadyLinked = new Set(existing.map((p) => p.sourceCommitmentId));

  const missing = commitments.filter((c) => !alreadyLinked.has(c.id));

  console.log(
    `\n  ${commitments.length} live commitment(s); ${missing.length} with nothing in the plan.\n`,
  );

  for (const c of missing) {
    const item = plannedItemFromCommitment(c);
    console.log(`  ${c.profile.user.email}  [${c.status}]  ${item.title}`);
  }

  if (missing.length === 0) {
    console.log("  Nothing to do.\n");
    return;
  }

  if (!write) {
    console.log("\n  Dry run. Re-run with --write to create these.\n");
    return;
  }

  let created = 0;
  for (const c of missing) {
    // Belt and braces: the rule is asserted again here rather than trusted
    // from the query above, so a widened `where` can never write a plan item
    // for a commitment that should not have one.
    if (!shouldBeInPlan(c.status)) continue;

    await prisma.plannedItem.upsert({
      where: { sourceCommitmentId: c.id },
      create: {
        ...plannedItemFromCommitment(c),
        profileId: c.profileId,
        sourceCommitmentId: c.id,
      },
      update: {},
    });
    created += 1;
  }

  console.log(`\n  Created ${created} plan item(s).\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
