// The loop: an evaluation recommends something, the student plans it, and the
// evaluation then shows that they have.
//
// Every piece of this existed before and none of them were connected — the
// student read a ranked action and retyped it into a form by hand. So the test
// is the round trip, not any single screen.
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const ACTION_TITLE = "Enter the Senior Maths Challenge in October";
const ACTION_DETAIL =
  "Cambridge and Imperial both read subject olympiads as the clearest signal of mathematical ability.";

const result = {
  overallScore: 58,
  gradeRelativeScore: 81,
  gradeContext: "Two different questions.",
  changeSinceLast: "First run.",
  headline: "Strong for your year.",
  summary: "A summary.",
  stageOutlook: {
    stageLabel: "Grade 11",
    whatMattersNow: "Depth",
    onTrack: "on_track",
    assessment: "Fine",
    reachableNow: [],
    notYetExpected: [],
  },
  systemScores: [],
  strengths: [],
  weaknesses: [],
  narrativeCoherence: { score: 70, assessment: "ok" },
  schoolFits: [],
  itemAssessments: [],
  actions: [
    {
      title: ACTION_TITLE,
      detail: ACTION_DETAIL,
      effort: "low",
      impact: "high",
      timeframe: "This term",
      appliesTo: [],
    },
  ],
  gaps: [],
  verifyThese: [],
};

async function seedEvaluation(email: string) {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const found = await client.query(
      'SELECT p.id FROM "Profile" p JOIN "User" u ON u.id = p."userId" WHERE u.email = $1',
      [email],
    );
    const profileId = found.rows[0].id;
    const id = randomUUID();
    await client.query(
      `INSERT INTO "Evaluation"
       ("id","profileId","status","model","promptVersion","isSample","resultJson","overallScore","createdAt","completedAt")
       VALUES ($1,$2,'completed','claude-opus-5','evaluation/v10',false,$3,58,NOW(),NOW())`,
      [id, profileId, JSON.stringify(result)],
    );
    return id;
  } finally {
    await client.end();
  }
}

test("a recommended action becomes a plan, and the evaluation shows it", async ({
  page,
}) => {
  const email = `e2e-loop-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Loop");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  const evaluationId = await seedEvaluation(email);
  await page.goto(`/evaluations/${evaluationId}`);

  // Before planning, the action offers itself.
  await expect(page.getByRole("link", { name: "Add to my plan" })).toBeVisible();
  await page.getByRole("link", { name: "Add to my plan" }).click();
  await page.waitForURL("**/plans/new**");

  // The form arrives filled in — this is the retyping that used to be manual.
  await expect(page.locator('input[name="title"]')).toHaveValue(ACTION_TITLE);
  await expect(page.locator('textarea[name="description"]')).toHaveValue(
    ACTION_DETAIL,
  );

  // The timeframe is shown as context, NOT converted into a date. A date here
  // would be a guess about this student's school year.
  await expect(page.getByText(/Your evaluation suggested: This term/i)).toBeVisible();
  await expect(page.locator('input[name="targetDate"]')).toHaveValue("");

  await page.getByRole("button", { name: "Add plan" }).click();
  await page.waitForURL("**/plans");
  await expect(page.getByText(ACTION_TITLE)).toBeVisible();

  // Back on the evaluation, the same action now reads as committed to. This is
  // the half that makes it a loop rather than a one-way link.
  await page.goto(`/evaluations/${evaluationId}`);
  await expect(page.getByText("In your plan")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to my plan" })).toHaveCount(0);
});

test("the plan form is still blank when reached directly", async ({ page }) => {
  const email = `e2e-loop-blank-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', "E2E Blank");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // Adding a plan of your own must not have become harder.
  await page.goto("/plans/new");
  await expect(page.getByRole("heading", { name: "Add a plan" })).toBeVisible();
  await expect(page.locator('input[name="title"]')).toHaveValue("");
  await expect(page.getByText(/Your evaluation suggested/i)).toHaveCount(0);
});
