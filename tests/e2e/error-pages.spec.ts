// The pages people see when something is wrong, rendered by a real browser.
//
// tests/unit/error-boundaries.test.ts asserts what the source says. This asserts
// that Next actually picks the files up — a boundary in the wrong directory, or
// named slightly wrong, is a file that passes every source check and is never
// rendered. The only way to tell the two apart is to break something and look.
//
// app/error.tsx IS NOT COVERED HERE, because covering it needs a route that
// throws on purpose and this app should not ship one. It was verified by hand
// the same way, and the recipe is worth keeping:
//
//   mkdir app/boom-check
//   echo 'export default function B(): never { throw new Error("boom") }' \
//     > app/boom-check/page.tsx
//   npx playwright test  # visit /boom-check, click Try again, then delete it
//
// Note the folder name. A directory starting with an underscore is a PRIVATE
// folder in the App Router and is not routed at all, so app/__boom renders the
// not-found page and looks exactly like a broken error boundary.
import { expect, test } from "@playwright/test";

test("a URL that matches nothing gets the app's own 404", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  // The status matters as much as the page: a 200 here would tell a crawler
  // the nonsense URL is a real page.
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole("heading", { name: /this page is not here/i }),
  ).toBeVisible();
  // Ours, not Next's default — which has no links at all.
  await expect(page.getByRole("link", { name: /go to your account/i })).toBeVisible();
});

test("a notFound() from inside a route renders the same page", async ({ page }) => {
  // /operations calls notFound() for anyone who is not an operator, which is
  // deliberate: a 403 would confirm the page exists. This checks that choice
  // still reaches the user as an ordinary 404 rather than as a stack trace.
  const response = await page.goto("/operations");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: /this page is not here/i }),
  ).toBeVisible();
  // The wording must not give away that the page exists and was withheld.
  await expect(page.getByText(/permission|forbidden|not allowed/i)).toHaveCount(0);
});
