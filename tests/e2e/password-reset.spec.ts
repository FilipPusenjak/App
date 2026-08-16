// Recovering an account you can't log into, end to end.
//
// The store is covered by integration tests and the token rules by unit tests.
// What only a browser can prove is the part in between: that the link opens a
// working form, that submitting it signs the person in, and — the thing that
// matters most — that the NEW password works and the OLD one does not.
//
// A reset that silently leaves the old password working would pass every test
// that stops at "the action returned ok".
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const password = "e2e-original-password";
const newPassword = "e2e-recovered-password";

/**
 * Issue a token directly against the test database, in raw SQL.
 *
 * Deliberately NOT going through lib/password-reset-store, and deliberately not
 * through Prisma either: this is the one place that should not share the
 * implementation's idea of how a token is stored. Writing the row by hand means
 * the app has to agree with the SCHEMA rather than merely with itself — if the
 * hashing changed on both sides at once, every other test would still pass and
 * this one would fail.
 */
async function issueTokenDirectly(email: string) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const found = await client.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [email.toLowerCase()],
    );
    const userId = found.rows[0]?.id;
    if (!userId) throw new Error(`No user with email ${email}`);

    const token = randomBytes(32).toString("base64url");
    await client.query(
      'INSERT INTO "PasswordResetToken" (id, "tokenHash", "userId", "expiresAt") VALUES ($1, $2, $3, $4)',
      [
        randomUUID(),
        createHash("sha256").update(token).digest("hex"),
        userId,
        new Date(Date.now() + 60 * 60 * 1000),
      ],
    );
    return token;
  } finally {
    await client.end();
  }
}

test("a locked-out user recovers their account with a reset link", async ({ page }) => {
  const email = `e2e-reset-${Date.now()}@example.test`;

  // ── 1. An account exists ────────────────────────────────────────────────
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Reset");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // ── 2. They come back later, signed out, and can't remember the password ─
  // Dropping the cookies is the honest simulation: signup signs you straight
  // in, and /login bounces an authenticated visitor to the dashboard.
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.waitForURL("**/forgot-password");
  await expect(page.getByText(/invite-only/i)).toBeVisible();

  // ── 3. The owner mints a link and sends it over ─────────────────────────
  const token = await issueTokenDirectly(email);

  // ── 4. Opening it offers the form ───────────────────────────────────────
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();

  // Mismatched entries are refused before anything is changed.
  await page.fill('input[name="password"]', newPassword);
  await page.fill('input[name="confirmPassword"]', "something-else-entirely");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText(/must match/i)).toBeVisible();

  // ── 5. Setting it signs them straight in ────────────────────────────────
  await page.fill('input[name="password"]', newPassword);
  await page.fill('input[name="confirmPassword"]', newPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await page.waitForURL("**/dashboard");

  // ── 6. The link is spent ────────────────────────────────────────────────
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await expect(page.getByText(/already been used/i)).toBeVisible();

  // ── 7. The new password works and the old one does NOT ──────────────────
  // The assertion the whole feature reduces to. A reset that quietly left the
  // old password working would satisfy every check above this line.
  await page.context().clearCookies();

  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password); // the OLD one
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();

  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
});
