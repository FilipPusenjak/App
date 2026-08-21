// Changing a student's country of origin after signup, in a real browser.
//
// Regression test for a bug where the profile page read the form's default
// value — and the confirmation line beneath it — from User.countryOfOrigin
// (the account-level default set once at signup) instead of
// Profile.countryOfOrigin (the per-student field the save action actually
// writes to). The save always worked; the page just kept showing the old
// value afterwards, which looks exactly like the switch being silently
// rejected. This reproduces that round trip: signup with one country, change
// it on the profile page, reload, and check what's actually on screen.
import { expect, test } from "@playwright/test";

const email = `e2e-country-${Date.now()}@example.test`;
const password = "e2e-password-123";

test("switching country of origin on the profile page sticks, including after a reload", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Country");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  // The account default, set once at signup.
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/profile");
  await expect(page.locator('select[name="countryOfOrigin"]')).toHaveValue("US");

  // Switch it on the student's own record.
  await page.selectOption('select[name="countryOfOrigin"]', "GB");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // The form must reflect the new value without a reload...
  await expect(page.locator('select[name="countryOfOrigin"]')).toHaveValue("GB");
  await expect(page.getByText("Country of origin: United Kingdom")).toBeVisible();

  // ...and, the case the bug actually broke, after a fresh navigation that
  // re-fetches the page from the server rather than trusting client state.
  await page.goto("/profile");
  await expect(page.locator('select[name="countryOfOrigin"]')).toHaveValue("GB");
  await expect(page.getByText("Country of origin: United Kingdom")).toBeVisible();
  // Asserted as exact text on the confirmation line specifically, not a
  // page-wide search: every country name is present as an <option> inside
  // the select regardless of which one is selected, so a blind text search
  // would always find "United States" sitting unselected in the dropdown.
  await expect(page.getByText("Country of origin:", { exact: false })).toHaveText(
    "Country of origin: United Kingdom",
  );
});
