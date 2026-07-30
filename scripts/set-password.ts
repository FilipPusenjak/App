// Set an account's password from the terminal — the recovery path.
//
//   npm run set-password -- student@example.com
//
// WHY THIS EXISTS
// There is no "forgot password" email flow. Without this script, a forgotten
// password on a live deployment means the account and everything in it are
// unreachable forever, and the login lockout (10 wrong attempts) makes that
// easier to hit than you'd think. This is the escape hatch.
//
// It is deliberately a local admin tool, not a web route: it runs from YOUR
// terminal against whatever DATABASE_URL is set, so it needs no authentication
// and adds no attack surface to the deployed app. To recover a production
// account, run it with the production DATABASE_URL in front of it:
//
//   DATABASE_URL="postgres://...neon..." npm run set-password -- you@example.com
//
// The new password is read from a prompt rather than an argument, so it never
// lands in your shell history.
import "dotenv/config";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signupSchema } from "@/lib/validation/auth";

// Control characters, named so the raw bytes aren't invisible in source.
const EOT = "\u0004";
const CTRL_C = "\u0003";
const BACKSPACE = "\u007f";

// Same cost as signup uses, so a recovered password is no weaker.
const BCRYPT_COST = 12;

/**
 * Lines fed in by a pipe, when stdin isn't a terminal. Read once and served in
 * order, so `printf 'pw\npw\n' | npm run set-password -- addr` works — useful
 * for scripting, and it's how this script is tested.
 */
let pipedLines: string[] | null = null;

async function readPipedLines(): Promise<string[]> {
  const chunks: string[] = [];
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) chunks.push(chunk as string);
  return chunks.join("").split(/\r?\n/);
}

/** Read one line, without echoing it when attached to a real terminal. */
async function promptHidden(question: string): Promise<string> {
  stdout.write(question);

  if (!stdin.isTTY) {
    pipedLines ??= await readPipedLines();
    const line = pipedLines.shift() ?? "";
    stdout.write("\n");
    return line;
  }

  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (fn: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      fn();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === EOT) {
          return finish(() => resolve(buffer));
        }
        if (ch === CTRL_C) {
          // Ctrl-C
          return finish(() => reject(new Error("Cancelled.")));
        }
        if (ch === BACKSPACE || ch === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };

    stdin.on("data", onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error(
      "Usage: npm run set-password -- <email>\n" +
        "Example: npm run set-password -- student@example.com",
    );
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, lockedUntil: true },
  });

  if (!user) {
    console.error(`No account found for ${email}.`);
    console.error(
      "Check the address, and check DATABASE_URL points at the right database " +
        "(it currently points at the one in your .env unless you overrode it).",
    );
    process.exit(1);
  }

  console.log(`Account: ${user.email}${user.name ? ` (${user.name})` : ""}`);
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    console.log("This account is currently locked out. That will be cleared.");
  }

  const password = await promptHidden("New password: ");
  const again = await promptHidden("Confirm password: ");

  if (password !== again) {
    console.error("Those don't match. Nothing was changed.");
    process.exit(1);
  }

  // Validate against the same rule the signup form enforces, so this can't
  // create a password the app itself would have rejected.
  const check = signupSchema.shape.password.safeParse(password);
  if (!check.success) {
    console.error(check.error.issues[0]?.message ?? "Invalid password.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.user.update({
    where: { id: user.id },
    // Clear the lockout too: someone running this is recovering access, and
    // leaving a live lock in place would block the password they just set.
    data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
  });

  console.log(`\nPassword updated for ${user.email}. You can sign in now.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
