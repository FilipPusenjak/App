// The full student journey, in one browser, end to end:
//
//   sign up → fill profile → add a test score → add a target →
//   run an evaluation (sample mode) → export the data → delete the account →
//   prove the account is actually gone.
//
// This is the test that exercises what no unit or integration test can: the
// real login flow with real cookies, server actions, redirects, and the
// wiring between all the pieces that are elsewhere tested in isolation.
import { expect, test } from "@playwright/test";

// Unique per run so a crashed run can't collide with the next one.
const email = `e2e-${Date.now()}@example.test`;
const password = "e2e-password-123";

test("a student's full journey", async ({ page }) => {
  // ── 1. Sign up (auto-login lands on the dashboard) ──────────────────────
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Student");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // ── 2. Academic profile ──────────────────────────────────────────────────
  await page.goto("/profile");
  await page.fill('input[name="gradeLevel"]', "Grade 11");
  await page.fill('input[name="schoolName"]', "E2E High School");
  await page.fill('input[name="gpa"]', "3.8");
  await page.fill('input[name="gpaScale"]', "4.0");
  await page.fill('input[name="intendedMajor"]', "Computer Science");
  await page.fill(
    'textarea[name="schoolContext"]',
    "Offers 8 APs, no IB. Does not rank.",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // A test score, so the evaluation has something to assess.
  await page.fill('input[name="label"]', "SAT");
  await page.fill('input[name="score"]', "1450");
  await page.fill('input[name="maxScore"]', "1600");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1450")).toBeVisible();

  // ── 3. A target school (UK, so the course-specific rubric applies) ──────
  await page.goto("/targets/new");
  await page.fill('input[name="name"]', "University of Cambridge");
  await page.selectOption('select[name="country"]', "GB");
  await page.fill('input[name="course"]', "Computer Science");
  await page.getByRole("button", { name: "Add target" }).click();
  await page.waitForURL("**/targets");
  await expect(page.getByText("University of Cambridge")).toBeVisible();

  // ── 4. Run an evaluation (no API key on this server → sample mode) ──────
  await page.goto("/evaluations");
  // "Run evaluation" is a client-side button: `next dev` serves the HTML
  // before React hydrates, and a click in that window does nothing (this
  // genuinely happened — the POST never fired). Retry until the click takes.
  await expect(async () => {
    if (/\/evaluations\/[a-z0-9]+/.test(page.url())) return;
    await page
      .getByRole("button", { name: "Run evaluation" })
      .click({ timeout: 2_000 });
    await page.waitForURL(/\/evaluations\/[a-z0-9]+/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });

  // The sample must be labelled as such, never passable as a real assessment.
  await expect(
    page.getByText("This is a sample, not an AI evaluation."),
  ).toBeVisible();
  await expect(page.getByText("University of Cambridge").first()).toBeVisible();

  // ── 4b. Plans and a projection (the hypothetical path) ──────────────────
  await page.goto("/plans/new");
  await page.fill('input[name="title"]', "Start a programming club");
  await page.fill(
    'textarea[name="description"]',
    "Run it weekly and enter two regional contests.",
  );
  await page.getByRole("button", { name: "Add plan" }).click();
  await page.waitForURL("**/plans");
  await expect(page.getByText("Start a programming club")).toBeVisible();

  // Same hydration caveat as the evaluation button.
  await expect(async () => {
    if (/\/projections\/[a-z0-9]+/.test(page.url())) return;
    await page
      .getByRole("button", { name: "Project my plans" })
      .click({ timeout: 2_000 });
    await page.waitForURL(/\/projections\/[a-z0-9]+/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });

  // The disclaimer that keeps a projection from reading as an achievement.
  await expect(page.getByText("None of this has happened yet.")).toBeVisible();
  await expect(
    page.getByText("This is a sample, not an AI projection."),
  ).toBeVisible();

  // ── 5. Export — same session, complete, and free of credentials ─────────
  const exportResponse = await page.request.get("/api/export");
  expect(exportResponse.ok()).toBeTruthy();
  expect(exportResponse.headers()["content-disposition"]).toContain(
    "attachment",
  );
  const raw = await exportResponse.text();
  expect(raw).not.toContain("passwordHash");

  // The export is per STUDENT: an account can hold several, and one that
  // quietly covered only the selected student would be a backup that isn't.
  const data = JSON.parse(raw) as {
    formatVersion: number;
    account: { email: string };
    students: {
      studentName: string | null;
      testScores: unknown[];
      resumeItems: { title: string }[];
      targetSchools: { name: string }[];
      evaluations: { isSample: boolean }[];
      plannedItems: { title: string }[];
      projections: { isSample: boolean }[];
    }[];
  };
  expect(data.formatVersion).toBe(2);
  expect(data.account.email).toBe(email);
  expect(data.students).toHaveLength(1);

  const student = data.students[0]!;
  expect(student.testScores).toHaveLength(1);
  expect(student.targetSchools[0]!.name).toBe("University of Cambridge");
  expect(student.evaluations).toHaveLength(1);
  expect(student.evaluations[0]!.isSample).toBe(true);
  // Plans and projections are exported, and kept in their own buckets.
  expect(student.plannedItems.map((p) => p.title)).toEqual([
    "Start a programming club",
  ]);
  expect(student.projections).toHaveLength(1);
  // THE ISOLATION GUARANTEE: a plan must never appear among achievements.
  expect(student.resumeItems.map((i) => i.title)).not.toContain(
    "Start a programming club",
  );

  // ── 5b. A second student, and the isolation between them ────────────────
  await page.goto("/students");
  await page.fill('input[name="studentName"]', "Second Student");
  await page.getByRole("button", { name: "Add student" }).click();
  await expect(page.getByText("Added Second Student.")).toBeVisible();

  // Adding switches to them, and their profile must be EMPTY — not a copy of
  // the first student's.
  await page.goto("/profile");
  await expect(page.locator('input[name="gradeLevel"]')).toHaveValue("");
  await page.goto("/evaluations");
  await expect(page.getByText("No evaluations yet.")).toBeVisible();

  // And the export now carries both, each with their own contents.
  const bothRaw = await (await page.request.get("/api/export")).text();
  const both = JSON.parse(bothRaw) as {
    students: { studentName: string | null; evaluations: unknown[] }[];
  };
  expect(both.students).toHaveLength(2);
  expect(both.students.map((s) => s.studentName)).toEqual([
    null,
    "Second Student",
  ]);
  expect(both.students[0]!.evaluations).toHaveLength(1);
  expect(both.students[1]!.evaluations).toHaveLength(0);

  // ── 6. Delete the account (retype-the-email confirmation) ───────────────
  await page.goto("/settings");
  // Same hydration caveat as the run button: retry until the danger zone
  // actually opens.
  const confirmField = page.locator('input[name="confirmEmail"]');
  await expect(async () => {
    if (await confirmField.isVisible()) return;
    await page
      .getByRole("button", { name: /Delete my account/ })
      .click({ timeout: 2_000 });
    await expect(confirmField).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await confirmField.fill(email);
  await page
    .getByRole("button", { name: "Permanently delete everything" })
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/settings"));

  // ── 7. Deleted means deleted ─────────────────────────────────────────────
  // The protected app now redirects to login...
  await page.goto("/profile");
  await page.waitForURL("**/login**");

  // ...and the credentials no longer work.
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});
