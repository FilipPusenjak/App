// The dashboard, in a real browser.
//
// It has two jobs and they belong to different people: tell a brand-new user
// what to do first, and tell a returning one where they stand. Both are tested
// because the empty state is what every student sees on day one and is the
// easiest thing to leave broken while building the interesting half.
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

test("a brand-new account is told what to do before evaluating", async ({ page }) => {
  await signUp(page, "empty");

  await expect(page.getByText("No evaluation yet")).toBeVisible();
  await expect(page.getByText("Before you evaluate")).toBeVisible();

  // The two things without which an evaluation cannot say anything.
  await expect(page.getByText("No target universities yet")).toBeVisible();
  await expect(page.getByText("Nothing on your resume yet")).toBeVisible();

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
  // Still missing these, so they must still be listed.
  await expect(page.getByText("No target universities yet")).toBeVisible();
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
});
