// The Students tab appearing and disappearing, in a real browser.
//
// The unit test covers the rule; this covers whether the rule is actually
// wired to the navigation — and whether turning the setting off can lose
// someone their students, which is the only way this change could do harm.
import { expect, test } from "@playwright/test";

async function signUp(page: import("@playwright/test").Page, label: string) {
  const email = `e2e-counselor-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");
  return email;
}

const studentsTab = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation").getByRole("link", { name: "Students" });

/**
 * Flip the setting and WAIT for the write to land.
 *
 * click() resolves when the click is dispatched, not when the server action it
 * submits has finished. Navigating straight afterwards aborts the request, and
 * the test then fails on a setting that was never saved — which looks exactly
 * like the feature being broken.
 */
async function toggleCounselorMode(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByText("I manage more than one student").click();
  await Promise.all([
    // Waits for the server action's OWN response, not for the network to fall
    // quiet. networkidle was the original wait and it is racy in the direction
    // that hides bugs: it resolves after 500ms of silence, so on a page that is
    // ALREADY idle when the click lands it can resolve before the request is
    // even issued. The test then navigates away mid-write and fails on a
    // setting that was never saved — which looks exactly like the feature being
    // broken, and only sometimes.
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/settings"),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
}

test("a solo student never sees the Students tab", async ({ page }) => {
  await signUp(page, "solo");
  await expect(studentsTab(page)).toHaveCount(0);
  // The other tabs are untouched.
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Evaluations" }).first(),
  ).toBeVisible();
});

test("turning on counselor mode adds the tab", async ({ page }) => {
  await signUp(page, "on");

  await toggleCounselorMode(page);
  await page.goto("/dashboard");
  await expect(studentsTab(page).first()).toBeVisible();

  // And it goes away again — this is a preference, not a one-way door.
  await toggleCounselorMode(page);
  await page.goto("/dashboard");
  await expect(studentsTab(page)).toHaveCount(0);
});

test("turning it off cannot hide students that already exist", async ({ page }) => {
  // The safety property. Switching a display setting must never leave a
  // student's own records owned, intact and unreachable.
  await signUp(page, "strand");

  await toggleCounselorMode(page);

  await page.goto("/students");
  await page.fill('input[name="studentName"]', "Priya Raman");
  await page.getByRole("button", { name: "Add student" }).click();
  // Scoped to <main>: the name also lands in the switcher's <select>, and an
  // <option> is never "visible" to Playwright.
  await expect(page.locator("main").getByText("Priya Raman").first()).toBeVisible();

  // Now switch it back off with two students on the account.
  await toggleCounselorMode(page);

  await page.goto("/dashboard");
  await expect(studentsTab(page).first()).toBeVisible();
});
