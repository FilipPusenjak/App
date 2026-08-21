// Picking a country on signup, then hitting an UNRELATED validation error.
//
// A third instance of the same defect fixed on the profile page's country
// field and the student switcher: React only reads a <select>'s defaultValue
// at mount, then reapplies that captured value on every later re-render — so
// this field didn't even need its own value to change to lose it. A password
// that's too short re-renders the form with a field error that has nothing to
// do with country, and the country pick the user just made vanished back to
// blank the moment the error appeared.
import { expect, test } from "@playwright/test";

test("an unrelated validation error does not wipe a country already picked", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Country Survives");
  await page.fill(
    'input[name="email"]',
    `e2e-signup-country-${Date.now()}@example.test`,
  );
  // Deliberately too short: fails signupSchema's password rule, unrelated to
  // country.
  await page.fill('input[name="password"]', "short");
  await page.selectOption('select[name="countryOfOrigin"]', "GB");
  await page.getByRole("button", { name: "Create account" }).click();

  // The password error appeared, confirming the round trip happened...
  await expect(
    page.getByText("Password must be at least 8 characters."),
  ).toBeVisible();
  // ...and the country pick from before that round trip must still be there.
  await expect(page.locator('select[name="countryOfOrigin"]')).toHaveValue("GB");
});
