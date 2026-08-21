// Who sees the Students tab, and who can add to it — in a real browser.
//
// There used to be an opt-in checkbox any account could flip on. It's gone: a
// new account can never become multi-student, only the Counselor Edition
// grants access to more than one. What's left to prove here is the safety
// property that survives the removal — an account that already had several
// profiles from before this closed must not have them stranded — and that a
// solo account really cannot reach any of this any more, not even by URL.
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const studentsTab = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation").getByRole("link", { name: "Students" });

async function signUp(page: import("@playwright/test").Page, label: string) {
  const email = `e2e-students-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");
  return email;
}

/**
 * Give an account a second profile the way one could only have arrived from
 * before this closed to new signups — directly, not through any UI the app
 * still offers. There is no addStudentAction any more, deliberately, so this
 * is the only way left to construct the state these tests need to check.
 */
async function seedSecondProfile(email: string, studentName: string) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const found = await client.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [email.toLowerCase()],
    );
    const userId = found.rows[0]?.id;
    if (!userId) throw new Error(`No user with email ${email}`);

    const profileId = randomUUID();
    await client.query(
      'INSERT INTO "Profile" (id, "userId", "studentName", "updatedAt") VALUES ($1, $2, $3, now())',
      [profileId, userId, studentName],
    );
    return profileId;
  } finally {
    await client.end();
  }
}

test("a solo account never sees the Students tab, and /students bounces it home", async ({
  page,
}) => {
  await signUp(page, "solo");
  await expect(studentsTab(page)).toHaveCount(0);
  // The other tabs are untouched.
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Evaluations" }).first(),
  ).toBeVisible();

  // Not just hidden from the nav — unreachable by URL too. There is nothing on
  // the page for a solo account to do (no way to add a second student any
  // more), so it redirects rather than showing an empty roster.
  await page.goto("/students");
  await page.waitForURL("**/dashboard");
});

test("an account with students from before this closed keeps the tab", async ({
  page,
}) => {
  const email = await signUp(page, "legacy");
  await seedSecondProfile(email, "Priya Raman");

  await page.goto("/dashboard");
  await expect(studentsTab(page).first()).toBeVisible();

  await page.goto("/students");
  await expect(page.locator("main").getByText("Priya Raman")).toBeVisible();
  // What's gone: nothing on the page offers a way to add a third.
  await expect(page.getByRole("button", { name: /add student/i })).toHaveCount(0);
});

test("switching, renaming and deleting still work for students from before", async ({
  page,
}) => {
  const email = await signUp(page, "manage");
  await seedSecondProfile(email, "Amara Okafor");

  await page.goto("/students");

  // A locator keyed on POSITION, not on the student's name — the name is
  // exactly what this test is about to change, twice, so a locator that
  // re-matches by name text (page.locator("li", { hasText: ... })) stops
  // finding the row the instant it succeeds at renaming it, and re-deriving
  // "the same li" via .filter({ has: <that locator> }) never matches at all:
  // two <li> are siblings, so one can never "contain" a match scoped to the
  // other. getOwnedProfiles orders by createdAt ascending, and getOrCreateProfile
  // made "Your profile" on the earlier /dashboard visit, so the seeded student
  // is deterministically second regardless of what it's later renamed to.
  const row = page.locator("li").nth(1);
  await expect(row).toContainText("Amara Okafor");

  // Switch to the second student.
  await row.getByRole("button", { name: "Select" }).click();
  await expect(row.getByText("selected")).toBeVisible();

  // Rename it.
  await row.locator('input[name="studentName"]').fill("Amara O.");
  await row.getByRole("button", { name: "Rename" }).click();
  await expect(row).toContainText("Amara O.");

  // Delete it — allowed, because it is no longer the only student.
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("main").getByText("Amara O.")).toHaveCount(0);

  // Down to one student again: the tab, and the page, close behind it — the
  // same rule a brand-new account has always been under.
  await page.goto("/dashboard");
  await expect(studentsTab(page)).toHaveCount(0);
  await page.goto("/students");
  await page.waitForURL("**/dashboard");
});
