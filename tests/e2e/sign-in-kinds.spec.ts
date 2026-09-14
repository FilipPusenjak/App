// Three products, one front door.
//
// Signing up and signing in are the only places a person chooses which of these
// they are, so this covers the whole of that choice in a real browser: that a
// counselor lands on a caseload, a tutor on a roster, and a student on a
// dashboard; that signing back in remembers which; that each professional
// surface bounces the other product's account; and that the field deciding it
// cannot be talked into handing out a caseload.
import { expect, test } from "@playwright/test";

const PASSWORD = "e2e-password-123";

async function signUpStudent(page: import("@playwright/test").Page, label: string) {
  const email = `e2e-kind-student-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="dateOfBirth"]', "2008-04-02");
  await page.getByRole("button", { name: "Create account" }).click();
  return email;
}

async function signUpCounselor(
  page: import("@playwright/test").Page,
  label: string,
) {
  const email = `e2e-kind-counselor-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.getByRole("radio", { name: /college counselor/i }).check();
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="dateOfBirth"]', "1985-06-14");
  await page.fill('input[name="orgName"]', `${label} Admissions`);
  await page.getByRole("button", { name: "Create counselor account" }).click();
  return email;
}

async function signUpTutor(page: import("@playwright/test").Page, label: string) {
  const email = `e2e-kind-tutor-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.getByRole("radio", { name: /test-prep tutor/i }).check();
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="dateOfBirth"]', "1985-06-14");
  await page.fill('input[name="orgName"]', `${label} Test Prep`);
  await page.getByRole("button", { name: "Create tutor account" }).click();
  return email;
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("a student signs up and lands on their own dashboard", async ({ page }) => {
  const email = await signUpStudent(page, "a");
  await page.waitForURL("**/dashboard");

  // And the counselor surface is not theirs to open.
  await page.goto("/caseload");
  await page.waitForURL("**/dashboard");

  await signIn(page, email);
  await page.waitForURL("**/dashboard");
});

test("a counselor signs up and lands on a caseload", async ({ page }) => {
  const email = await signUpCounselor(page, "b");
  await page.waitForURL("**/caseload");
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();

  // The practice name is what a family sees when deciding, so it is on screen.
  await expect(page.getByText("b Admissions")).toBeVisible();

  // Signing back in returns them to the caseload rather than to a dashboard.
  await signIn(page, email);
  await page.waitForURL("**/caseload");
});

test("a tutor signs up and lands on a roster, not a caseload", async ({ page }) => {
  // The whole reason TUTOR exists as a kind. Before it, this radio created a
  // counselor and the tutor edition had no front door.
  const email = await signUpTutor(page, "t");
  await page.waitForURL("**/students-testprep");
  // exact: the roster's empty state is a second heading, "No students yet",
  // and a substring match resolves to both.
  await expect(
    page.getByRole("heading", { name: "Students", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("t Test Prep")).toBeVisible();

  // Signing back in returns them to the roster.
  await signIn(page, email);
  await page.waitForURL("**/students-testprep");
});

test("each professional surface bounces the other product's account", async ({
  page,
}) => {
  // Same account table, different products. A tutor on /caseload would see a
  // triage queue that was never theirs; a counselor on /students-testprep an
  // empty roster that reads as broken.
  await signUpTutor(page, "x");
  await page.waitForURL("**/students-testprep");
  await page.goto("/caseload");
  await page.waitForURL("**/students-testprep");

  // Signed out first: /signup redirects an authenticated account away, so the
  // second signup would otherwise wait forever for a radio that never renders.
  await page.context().clearCookies();
  await signUpCounselor(page, "y");
  await page.waitForURL("**/caseload");
  await page.goto("/students-testprep");
  await page.waitForURL("**/caseload");
});

test("a counselor with no students is told so, not shown an empty grid", async ({
  page,
}) => {
  await signUpCounselor(page, "c");
  await page.waitForURL("**/caseload");
  await expect(page.getByText(/A student appears here once both/i)).toBeVisible();
});

test("a caseload cannot be minted by editing the form", async ({ page }) => {
  // The account kind is a privilege decision on a form anyone can post to. The
  // server coerces an unrecognised value to the LESS privileged account, so a
  // tampered field must produce a student — not an error page, and certainly
  // not a caseload.
  const email = `e2e-kind-tamper-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Tamper");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="dateOfBirth"]', "2008-04-02");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[name="accountKind"]')) {
      (el as HTMLInputElement).value = "COUNSELOR_PLEASE";
      (el as HTMLInputElement).checked = true;
    }
  });
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/dashboard");
  await page.goto("/caseload");
  await page.waitForURL("**/dashboard");
});

test("the signup form asks for a practice name before opening a caseload", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByRole("radio", { name: /college counselor/i }).check();
  await page.fill('input[name="name"]', "E2E NoOrg");
  await page.fill('input[name="email"]', `e2e-kind-noorg-${Date.now()}@example.test`);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="dateOfBirth"]', "2008-04-02");
  await page.getByRole("button", { name: "Create counselor account" }).click();

  await expect(
    page.getByText(/what your practice is called/i),
  ).toBeVisible();
  // And it stayed on the form rather than creating anything.
  await expect(page).toHaveURL(/\/signup/);
});
