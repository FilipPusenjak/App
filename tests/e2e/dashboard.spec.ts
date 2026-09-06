// The dashboard, in a real browser.
//
// It has two jobs and they belong to different people: tell a brand-new user
// what to do first, and tell a returning one where they stand. Both are tested
// because the empty state is what every student sees on day one and is the
// easiest thing to leave broken while building the interesting half.
//
// A brand-new account is shown a two-step checklist rather than a list of
// gaps. Both steps are always listed, ticked or not — see
// lib/evaluation/prerequisites.ts for why — and the gaps card underneath is
// filtered to the optional ones, so the same advice is never printed twice.
// These tests assert on that checklist's own copy. They used to assert on the
// gap lines ("No target universities yet") that the checklist replaced, and
// were red for four merges before anybody looked at the e2e step.
import { expect, test } from "@playwright/test";

async function signUp(page: import("@playwright/test").Page, label: string) {
  const email = `e2e-dash-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");
  return email;
}

/** The two checklist steps, as they read when still to do — i.e. as links. */
const TARGET_STEP = "Add a university you're aiming at";
const CONTENT_STEP = "Add an activity or a test score";

test("a brand-new account is told what to do before evaluating", async ({ page }) => {
  await signUp(page, "empty");

  await expect(page.getByText("Before your first Deep Review")).toBeVisible();

  // Both steps, both undone, both pointing somewhere. A step still to do is a
  // link; a done one is struck through and is not.
  await expect(page.getByRole("link", { name: TARGET_STEP })).toBeVisible();
  await expect(page.getByRole("link", { name: CONTENT_STEP })).toBeVisible();

  // The blocking gaps are NOT repeated underneath — the checklist already says
  // it, and printing "No target universities yet" a second time is the
  // duplication the filter exists to prevent.
  await expect(page.getByText("No target universities yet")).toHaveCount(0);
  await expect(page.getByText("Nothing on your resume yet")).toHaveCount(0);

  // The optional gaps still show, under a heading that says they are optional.
  await expect(page.getByText("Worth adding while you're here")).toBeVisible();

  // No scores are shown, because none have been produced. A dashboard that
  // rendered a zero here would be stating a judgement nothing made.
  await expect(page.getByText("/100")).toHaveCount(0);
});

test("gaps disappear as the profile is filled in", async ({ page }) => {
  await signUp(page, "gaps");

  await page.goto("/profile");
  await page.fill('input[name="gradeLevel"]', "Grade 11");
  await page.fill(
    'textarea[name="schoolContext"]',
    "Offers 8 APs, no IB. Does not rank.",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Grade level not set")).toHaveCount(0);
  await expect(page.getByText("No school context")).toHaveCount(0);
  // Still no target and nothing to assess, so both steps are still to do.
  await expect(page.getByRole("link", { name: TARGET_STEP })).toBeVisible();
  await expect(page.getByRole("link", { name: CONTENT_STEP })).toBeVisible();
});

test("a target with no course is named, not just counted", async ({ page }) => {
  await signUp(page, "course");

  await page.goto("/targets/new");
  await page.fill('input[name="name"]', "University of Somewhere");
  await page.selectOption('select[name="country"]', "GB");
  // Deliberately no course.
  await page.getByRole("button", { name: "Add target" }).click();
  await page.waitForURL("**/targets");

  await page.goto("/dashboard");
  await expect(page.getByText("1 target without a course")).toBeVisible();
  // Naming it is the point — "1 target" alone leaves the student hunting.
  await expect(page.getByText(/University of Somewhere/)).toBeVisible();

  // And the checklist ticks the step off: it is stated as done, not merely
  // gone, so the remaining one reads as "one thing left" rather than "a list".
  await expect(page.getByRole("link", { name: TARGET_STEP })).toHaveCount(0);
  await expect(page.getByText(TARGET_STEP)).toBeVisible();
  await expect(page.getByRole("link", { name: CONTENT_STEP })).toBeVisible();
});
