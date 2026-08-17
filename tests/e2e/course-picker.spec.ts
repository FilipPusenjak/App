// The course picker, in a real browser.
//
// The unit tests cover the copy and the integration tests cover the query. What
// only a browser shows is whether the two are actually wired to each other:
// that typing a university name causes a lookup, that the result reaches the
// field, and that the student can see they have landed on a name that resolves.
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const UNIVERSITY = "Testbrook University";
const COURSE = "Computer Science B.A. (Hons)/M.Eng.";

/** Seed a researched course straight into the test database, in raw SQL. */
async function seedCourse() {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    // matchKey mirrors lib/requirements/match.ts: COUNTRY::university::course,
    // normalized. Written by hand so the app has to agree with the schema
    // rather than merely with itself.
    const key = `GB::testbrook university::computer science b a hons m eng`;
    await client.query('DELETE FROM "CourseRequirement" WHERE "matchKey" = $1', [key]);
    await client.query(
      `INSERT INTO "CourseRequirement"
       ("id","matchKey","university","country","course","cycleYear","stale",
        "gatheredOn","primarySourceUrl","requirementsJson","updatedAt")
       VALUES ($1,$2,$3,'GB',$4,$5,false,NOW(),$6,$7,NOW())`,
      [
        randomUUID(),
        key,
        UNIVERSITY,
        COURSE,
        new Date().getUTCFullYear() + 1,
        "https://www.example.ac.uk/courses/cs",
        JSON.stringify({
          gradeRequirement: {
            value: "A*AA including Mathematics",
            quote: "The typical offer for this course is A*AA including Mathematics.",
            sourceUrl: "https://www.example.ac.uk/courses/cs",
          },
        }),
      ],
    );
    return key;
  } finally {
    await client.end();
  }
}

async function removeCourse(key: string) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('DELETE FROM "CourseRequirement" WHERE "matchKey" = $1', [key]);
  } finally {
    await client.end();
  }
}

test("the course field offers the names we hold requirements for", async ({ page }) => {
  const key = await seedCourse();
  const email = `e2e-picker-${Date.now()}@example.test`;

  try {
    await page.goto("/signup");
    await page.fill('input[name="name"]', "E2E Picker");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "e2e-password-123");
    await page.selectOption('select[name="countryOfOrigin"]', "US");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/targets/new");

    // Before a university is named there is nothing to offer, and the field
    // must not imply otherwise.
    await expect(page.getByText(/UK course-specific admissions/i)).toBeVisible();

    await page.selectOption('select[name="country"]', "GB");
    await page.fill('input[name="name"]', UNIVERSITY);

    // The lookup is debounced; the assertion waits for it rather than racing.
    await expect(page.getByText(/1 course at this university/i)).toBeVisible({
      timeout: 15_000,
    });

    // The real name reached the field as a suggestion.
    await expect(page.locator(`datalist option[value="${COURSE}"]`)).toHaveCount(1);

    // Typing something else is allowed and never called wrong.
    await page.fill('input[name="course"]', "Computer Science");
    await expect(page.getByText(/keep your own wording/i)).toBeVisible();

    // Landing on the exact stored name is confirmed, which is the whole point.
    await page.fill('input[name="course"]', COURSE);
    await expect(page.getByText(/real published entry requirements/i)).toBeVisible();

    await page.getByRole("button", { name: "Add target" }).click();
    await page.waitForURL("**/targets");
    await expect(page.getByText(UNIVERSITY)).toBeVisible();
  } finally {
    await removeCourse(key);
  }
});

test("a university with no researched courses says so without scolding", async ({
  page,
}) => {
  const email = `e2e-picker-none-${Date.now()}@example.test`;

  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Picker None");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/targets/new");
  await page.selectOption('select[name="country"]', "GB");
  await page.fill('input[name="name"]', "University of Nowhere At All");

  // The majority case for most students. It has to read as ordinary, and the
  // form has to stay fully usable.
  await expect(page.getByText(/check the official course page/i)).toBeVisible({
    timeout: 15_000,
  });
  await page.fill('input[name="course"]', "Underwater Basket Weaving");
  await page.getByRole("button", { name: "Add target" }).click();
  await page.waitForURL("**/targets");
  await expect(page.getByText("University of Nowhere At All")).toBeVisible();
});
