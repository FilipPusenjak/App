// Mint a password reset link for an account.
//
//   DATABASE_URL="<production>" npx tsx scripts/reset-link.ts someone@example.com
//   DATABASE_URL="<production>" npx tsx scripts/reset-link.ts someone@example.com --base https://your-app.vercel.app
//
// OPERATOR SCRIPT. It creates a credential that can take over an account
// without its password, so it is a CLI tool run by the person who owns the
// instance with an explicit DATABASE_URL — never a route, and never something
// reachable from the browser.
//
// Send the printed URL to the person over a channel you trust. It works once
// and expires; if it leaks, run this again and the old one dies with it.
import { issueResetToken } from "../lib/password-reset-store";
import { RESET_TOKEN_TTL_MINUTES } from "../lib/password-reset";
import { prisma } from "../lib/db";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const baseFlagIndex = args.indexOf("--base");
const baseFlag = baseFlagIndex >= 0 ? args[baseFlagIndex + 1] : undefined;

/**
 * Where the link should point.
 *
 * Guessing wrong produces a link that looks right and goes nowhere, so this
 * fails loudly rather than defaulting to localhost — the address of the one
 * machine the recipient is definitely not using.
 */
function baseUrl(): string {
  const candidate =
    baseFlag ||
    process.env.APP_URL ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!candidate) {
    console.error(
      "\n  Don't know what URL this app is served from, and a link to the\n" +
        "  wrong host is worse than no link.\n\n" +
        "  Pass it explicitly:  --base https://your-app.vercel.app\n" +
        "  or set APP_URL.\n",
    );
    process.exit(1);
  }
  return candidate.replace(/\/+$/, "");
}

async function main() {
  if (!email) {
    console.error(
      "\n  Usage: npx tsx scripts/reset-link.ts <email> [--base https://host]\n",
    );
    process.exit(1);
  }

  const base = baseUrl();
  const issued = await issueResetToken(email);

  if (!issued) {
    // Safe to say plainly here and nowhere else: the audience is the instance
    // owner, for whom "that address has no account" is the useful answer.
    console.error(`\n  No account with the address ${email}.\n`);
    process.exit(1);
  }

  console.log(`\n  Reset link for ${email}:\n`);
  console.log(
    `    ${base}/reset-password?token=${encodeURIComponent(issued.token)}\n`,
  );
  console.log(
    `  Works once, expires in ${RESET_TOKEN_TTL_MINUTES} minutes ` +
      `(${issued.expiresAt.toISOString()}).`,
  );
  console.log(
    `  Any earlier link for this account has just been invalidated.\n`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
