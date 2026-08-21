// Switching which student is active, in a real browser.
//
// Regression test for the same class of bug fixed on the profile page's
// country field: React only reads a <select>'s defaultValue AT MOUNT, then
// silently reapplies that captured value on every later re-render — not the
// new prop, and not even the option the user just clicked. switchStudentAction
// stays on the current page (no redirect) and revalidates in place, which is
// exactly the shape that exposes it: the account's active student really did
// change — the rest of the page reflects it — but the switcher itself kept
// showing whoever was active when it first mounted, so it looked like the
// switch silently failed.
import { expect, test } from "@playwright/test";

const email = `e2e-switcher-${Date.now()}@example.test`;
const password = "e2e-password-123";

test("the student switcher reflects a switch immediately, not just after a reload", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Switcher");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // Turn on multi-student mode — the switcher renders for nobody else.
  await page.goto("/settings");
  await page.getByText("I manage more than one student").click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/settings"),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  await page.goto("/students");
  await page.fill('input[name="studentName"]', "Second Student");
  await page.getByRole("button", { name: /add student/i }).click();
  await expect(page.getByText("Added Second Student.")).toBeVisible();

  // Two instances render (a mobile one collapsed behind a disclosure, and a
  // desktop one) — the desktop one is last in document order and is what's
  // actually visible at this viewport.
  await page.goto("/dashboard");
  const switcher = page.locator('select[name="profileId"]').last();
  const switchButton = page.getByRole("button", { name: "Switch" }).last();

  const options = await switcher.locator("option").all();
  const values = await Promise.all(options.map((o) => o.getAttribute("value")));
  const before = await switcher.inputValue();
  const other = values.find((v) => v !== before)!;

  await switcher.selectOption(other);
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/dashboard"),
    ),
    switchButton.click(),
  ]);
  // A short settle beyond the network response, for React to actually commit
  // the revalidated render — the failure this guards is React reasserting a
  // stale defaultValue on that commit, which happens just after the response
  // lands, not on it.
  await page.waitForTimeout(500);

  // A SNAPSHOT read, deliberately not a retrying assertion. toHaveValue(other)
  // would pass instantly and stop polling — the browser already shows "other"
  // from selectOption() above, before any server round trip — so it can report
  // success on a value that reverts moments later once the revalidated render
  // actually commits. This is exactly the render the bug lives in, so the
  // assertion has to look at it, not stop at the first thing that happens to
  // match before it occurs.
  expect(await switcher.inputValue()).toBe(other);

  // And it survives a fresh navigation too, confirming the underlying data —
  // not just the DOM — actually changed.
  await page.goto("/dashboard");
  await expect(page.locator('select[name="profileId"]').last()).toHaveValue(other);
});
