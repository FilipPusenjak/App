// Mint access codes to hand out during testing.
//
//   DATABASE_URL="<prod>" npx tsx scripts/make-access-code.ts --kind DEEP_REVIEW
//   DATABASE_URL="<prod>" npx tsx scripts/make-access-code.ts \
//     --kind PROJECTION --count 5 --uses 1 --days 30 --note "beta testers"
//
// OPERATOR SCRIPT, deliberately not a route. Minting is the one privileged
// operation in this system — a route for it would need an authorization model
// of its own, and the only person who mints codes is the person who already
// holds the database credential.
//
// A code grants a RUN, never a price change. See lib/billing/codes.ts.
import { createAccessCode } from "../lib/billing/codes";
import { RUN_KINDS, type RunKind } from "../lib/billing/quota";
import { prisma } from "../lib/db";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  console.error(
    "  Usage: npx tsx scripts/make-access-code.ts --kind <KIND> [options]\n\n" +
      `    --kind   ${RUN_KINDS.join(" | ")}\n` +
      "    --count  how many codes to mint (default 1)\n" +
      "    --uses   how many DIFFERENT accounts may redeem each (default 1)\n" +
      "    --grants runs each redemption is worth (default 1)\n" +
      "    --days   days until the code expires (default: never)\n" +
      "    --note   why these exist, stored alongside them\n",
  );
  process.exit(1);
}

async function main() {
  const kind = arg("kind") as RunKind | undefined;
  if (!kind || !(RUN_KINDS as readonly string[]).includes(kind)) {
    fail(`--kind is required and must be one of: ${RUN_KINDS.join(", ")}`);
  }

  const count = Number.parseInt(arg("count") ?? "1", 10);
  const uses = Number.parseInt(arg("uses") ?? "1", 10);
  const grants = Number.parseInt(arg("grants") ?? "1", 10);
  const days = arg("days") ? Number.parseInt(arg("days")!, 10) : null;
  const note = arg("note") ?? null;

  for (const [label, value] of [
    ["count", count],
    ["uses", uses],
    ["grants", grants],
  ] as const) {
    if (!Number.isFinite(value) || value < 1) fail(`--${label} must be a positive number.`);
  }
  if (days !== null && (!Number.isFinite(days) || days < 1)) {
    fail("--days must be a positive number of days.");
  }

  const expiresAt =
    days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const made: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { code } = await createAccessCode({
      kind,
      grantsCount: grants,
      maxRedemptions: uses,
      expiresAt,
      note,
    });
    made.push(code);
  }

  console.log(
    `\n  ${made.length} code(s) for ${kind}, ` +
      `${grants} run(s) each, redeemable by ${uses} account(s)` +
      `${expiresAt ? `, expiring ${expiresAt.toDateString()}` : ", no expiry"}.\n`,
  );
  for (const code of made) console.log(`    ${code}`);
  console.log(
    "\n  Redeemed at /settings/billing. A code is only spent when the plan's" +
      "\n  schedule would otherwise refuse a run, so handing one out early is safe.\n",
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
