// Every evaluation shape, rendered in a real browser.
//
// The bug this exists to catch is not a crash. Before the detail page
// understood more than one shape it rendered a Deep Review as the single line
// "No result was stored for this evaluation" — a page that loads, returns 200,
// and tells a student their review does not exist. Nothing but opening it in a
// browser would have shown that, which is why this is an e2e test and not
// another unit test of the reader.
//
// The rows are seeded directly: the e2e server runs without an API key, so a
// real Deep Review cannot be produced here, and waiting for one would be
// testing Anthropic rather than this page.
// Seeded with `pg` rather than Prisma: the generated client is ESM-only and
// Playwright's transform loads specs as CommonJS. Raw SQL also keeps the seed
// honest — it writes the columns the routes write, with no client-side defaults
// quietly filling anything in.
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });

test.beforeAll(async () => {
  await db.connect();
});

test.afterAll(async () => {
  await db.end();
});

/** Postgres has no cuid(); ids only need to be unique and URL-safe here. */
const newId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function signUpAndGetProfile(
  page: import("@playwright/test").Page,
  label: string,
) {
  const email = `e2e-shape-${label}-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', `E2E ${label}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "e2e-password-123");
  await page.selectOption('select[name="countryOfOrigin"]', "US");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id FROM "Profile" p
       JOIN "User" u ON u.id = p."userId"
      WHERE u.email = $1`,
    [email],
  );
  if (!rows[0]) throw new Error(`No profile for ${email}`);
  return rows[0].id;
}

/** Insert one evaluation row and return its id. */
async function seedEvaluation(fields: {
  profileId: string;
  type?: string;
  promptVersion?: string | null;
  resultJson?: string | null;
  overallScore?: number | null;
  paceStatus?: string | null;
  thresholdSnapshotJson?: string | null;
  differentiationSnapshotJson?: string | null;
  materialChange?: boolean | null;
}) {
  const id = newId("ev");
  await db.query(
    `INSERT INTO "Evaluation"
       (id, "profileId", type, status, "completedAt", "createdAt",
        "promptVersion", "resultJson", "overallScore", "paceStatus",
        "thresholdSnapshotJson", "differentiationSnapshotJson",
        "materialChange", "isSample")
     VALUES ($1,$2,$3,'completed',NOW(),NOW(),$4,$5,$6,$7,$8,$9,$10,false)`,
    [
      id,
      fields.profileId,
      fields.type ?? "DEEP_REVIEW",
      fields.promptVersion ?? null,
      fields.resultJson ?? null,
      fields.overallScore ?? null,
      fields.paceStatus ?? null,
      fields.thresholdSnapshotJson ?? null,
      fields.differentiationSnapshotJson ?? null,
      fields.materialChange ?? null,
    ],
  );
  return id;
}

const deepReviewNarrative = {
  headline: "Your physics thread is the one worth deepening.",
  sinceLastReview:
    "This is your baseline — there is no earlier review to compare against.",
  trajectory: {
    assessment: "Recent work goes meaningfully deeper than last year's.",
    direction: "STEEPENING",
  },
  coherence: {
    assessment: "Most of what you do points the same way.",
    incoherences: ["The debate club sits apart from everything else."],
  },
  differentiation: {
    assessment: "One genuinely unusual thread, and several ordinary ones.",
    escalationOpportunities: ["Submit the simulation to a student journal."],
  },
  schoolFits: [
    {
      schoolName: "Imperial College London",
      course: "Physics",
      rubricUsed: "uk_course",
      selectivity: "extremely_selective",
      classification: "reach",
      classificationReason: "Predicted grades sit below the standard offer.",
      assessment: "The physics work is real; the grades are the constraint.",
      keyRisks: ["No further maths on the timetable."],
    },
  ],
  itemAssessments: [
    {
      itemRef: "R1",
      itemTitle: "Orbital mechanics simulation",
      helpfulness: "high",
      foundationalValue: "high",
      compoundsInto: "A publishable write-up, or a conference poster.",
      verdict: "The strongest single thing on your profile.",
      howToStrengthen: "Write up the method so someone else could reproduce it.",
      bestFor: ["Imperial College London"],
    },
  ],
  gaps: [
    {
      title: "No further maths",
      detail: "Several physics courses list it as required, not preferred.",
      feasibility: "TIGHT",
      monthsNeeded: 9,
    },
  ],
  verifyThese: [
    "Whether Imperial requires Further Maths for Physics in your cycle.",
  ],
  proposedCommitments: [
    { description: "Write up the simulation method", targetRung: null, dueInWeeks: 8 },
    { description: "Speak to school about Further Maths", targetRung: null, dueInWeeks: 4 },
  ],
};

const checkInNarrative = {
  headline: "The write-up moved; nothing else did.",
  movement: { direction: "UP", driver: "Finished the method section." },
  nextRung: {
    activityId: "R1",
    currentRung: "contributor",
    targetRung: "recognized",
    concreteStep: "Send the draft to one journal that takes student work.",
  },
  actionThisFortnight: "Email your physics teacher for a read of the draft.",
  commitmentPrompts: [],
};

test("the retired tier's review still renders in full", async ({ page }) => {
  // The promise made when that tier was retired: no new one can be produced,
  // and the ones that exist are not lost. A reader deleted along with the route
  // would render this as "No result was stored for this evaluation" — a page
  // that loads, returns 200, and tells a student their review does not exist.
  const profileId = await signUpAndGetProfile(page, "deep");

  const reviewId = await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "deep-review/v1",
    paceStatus: "ON_PACE",
    thresholdSnapshotJson: JSON.stringify({ band: "gaps to close" }),
    differentiationSnapshotJson: JSON.stringify({ band: "competitive" }),
    resultJson: JSON.stringify(deepReviewNarrative),
  });
  // updatedAt is @updatedAt — generated by the Prisma CLIENT, so raw SQL has
  // to set it or the NOT NULL constraint rejects the row.
  await db.query(
    `INSERT INTO "Commitment"
       (id, "profileId", "sourceEvaluationId", description, status, "dueDate",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'PROPOSED',$5,NOW(),NOW())`,
    [
      newId("cm"),
      profileId,
      reviewId,
      "Write up the simulation method",
      new Date("2026-10-01"),
    ],
  );

  await page.goto(`/evaluations/${reviewId}`);
  const main = page.locator("main");

  // The failure this test exists for.
  await expect(page.getByText("No result was stored")).toHaveCount(0);

  // Named APART from the review that runs today, and asserted exactly —
  // substring matching would let the live name pass here and hide a collapse
  // of two very different documents under one label.
  await expect(
    page.getByRole("heading", {
      name: "Deep Review (earlier format)",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(main.getByText("physics thread is the one worth")).toBeVisible();

  // Bands, as words — and their meanings, so neither is a bare label.
  await expect(main.getByText("gaps to close").first()).toBeVisible();
  await expect(main.getByText("competitive").first()).toBeVisible();
  await expect(
    main.getByText("some published requirements aren't met yet"),
  ).toBeVisible();

  // Absolutely no percentile anywhere on a Deep Review. This is the rule the
  // whole tier was built around, and it is worth asserting on the rendered
  // page rather than only on the schema.
  await expect(main.getByText("/100")).toHaveCount(0);
  await expect(main.getByText("%")).toHaveCount(0);

  // The sections that carry the actual review.
  await expect(main.getByText("Levelling off")).toHaveCount(0);
  await expect(main.getByText("Picking up")).toBeVisible();
  await expect(main.getByText("The debate club sits apart")).toBeVisible();
  await expect(main.getByText("Submit the simulation")).toBeVisible();
  await expect(main.getByText("Imperial College London").first()).toBeVisible();
  await expect(main.getByText("extremely selective")).toBeVisible();
  await expect(main.getByText("Orbital mechanics simulation")).toBeVisible();
  await expect(main.getByText("tight on time")).toBeVisible();
  await expect(main.getByText("Whether Imperial requires")).toBeVisible();

  // The commitment, with its live status — proposed, never auto-accepted.
  // Exact: the explanatory subtitle also contains the word.
  await expect(main.getByText("proposed", { exact: true })).toBeVisible();
  await expect(main.getByText("Write up the simulation method")).toBeVisible();

  await page.screenshot({
    path: "test-results/deep-review.png",
    fullPage: true,
  });
});

test("a Check-In renders as a fortnight, not a standing", async ({ page }) => {
  const profileId = await signUpAndGetProfile(page, "checkin");

  const checkInId = await seedEvaluation({
    profileId,
    type: "CHECK_IN",
    promptVersion: "check-in/v1",
    materialChange: true,
    paceStatus: "ON_PACE",
    resultJson: JSON.stringify(checkInNarrative),
  });

  await page.goto(`/evaluations/${checkInId}`);
  const main = page.locator("main");

  await expect(page.getByText("No result was stored")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Check-In", level: 1 }),
  ).toBeVisible();
  await expect(main.getByText("The write-up moved")).toBeVisible();
  await expect(main.getByText("something moved forward")).toBeVisible();
  await expect(main.getByText("Email your physics teacher")).toBeVisible();
  // The rung ladder names both ends, so the step is checkable.
  await expect(main.getByText("contributor")).toBeVisible();
  await expect(main.getByText("recognized")).toBeVisible();
  // It must say outright that it is not the whole picture.
  await expect(main.getByText("not a full assessment")).toBeVisible();

  await page.screenshot({
    path: "test-results/check-in.png",
    fullPage: true,
  });
});

test("a no-change Check-In explains itself instead of looking broken", async ({
  page,
}) => {
  const profileId = await signUpAndGetProfile(page, "nochange");

  const checkInId = await seedEvaluation({
    profileId,
    type: "CHECK_IN",
    materialChange: false,
    paceStatus: "ON_PACE",
  });

  await page.goto(`/evaluations/${checkInId}`);
  const main = page.locator("main");

  // This row genuinely has no narrative. That is the system working, and the
  // page must not describe it as an absence of data.
  await expect(page.getByText("No result was stored")).toHaveCount(0);
  await expect(main.getByText("Nothing material changed")).toBeVisible();
  await expect(main.getByText("used none of your quota")).toBeVisible();
});

test("a pre-v6 legacy evaluation still renders", async ({ page }) => {
  const profileId = await signUpAndGetProfile(page, "legacy");

  // A v5-era row: no selectivity or classification on its school fits, and no
  // stage outlook. These are the rows a strict reader silently refuses.
  const legacyId = await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "evaluation/v5",
    overallScore: 58,
    resultJson: JSON.stringify({
        overallScore: 58,
        gradeRelativeScore: 81,
        gradeContext: "Two different questions.",
        headline: "An older evaluation, still readable.",
        summary: "A summary written under prompt v5.",
        strengths: [],
        weaknesses: [],
        narrativeCoherence: { score: 70, assessment: "Coherent enough." },
        schoolFits: [
          {
            schoolName: "Imperial College London",
            course: "Physics",
            rubricUsed: "uk_course",
            country: "United Kingdom",
            fitScore: 64,
            assessment: "A stretch on current predictions.",
            keyRisks: [],
          },
        ],
      gaps: [],
      verifyThese: [],
    }),
  });

  await page.goto(`/evaluations/${legacyId}`);
  const main = page.locator("main");

  await expect(page.getByText("No result was stored")).toHaveCount(0);
  await expect(main.getByText("An older evaluation, still readable.")).toBeVisible();
  // Its percentiles are intact — this shape is the one that HAS them.
  await expect(main.getByText("58").first()).toBeVisible();
  await expect(main.getByText("Imperial College London").first()).toBeVisible();
});

test("a proposed commitment can be accepted, and then declined ones stay declined", async ({
  page,
}) => {
  const profileId = await signUpAndGetProfile(page, "commit");

  const reviewId = await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "deep-review/v1",
    paceStatus: "ON_PACE",
    thresholdSnapshotJson: JSON.stringify({ band: "gaps to close" }),
    differentiationSnapshotJson: JSON.stringify({ band: "competitive" }),
    resultJson: JSON.stringify(deepReviewNarrative),
  });
  const commitmentId = newId("cm");
  await db.query(
    `INSERT INTO "Commitment"
       (id, "profileId", "sourceEvaluationId", description, status, "dueDate",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'PROPOSED',$5,NOW(),NOW())`,
    [commitmentId, profileId, reviewId, "Write up the simulation method", new Date("2026-10-01")],
  );

  await page.goto(`/evaluations/${reviewId}`);
  const main = page.locator("main");

  // The whole point of this test: before this existed, the API was reachable
  // and nothing in the app ever called it, so every commitment stayed PROPOSED
  // forever and the check-in loop had nothing to track.
  await expect(main.getByRole("button", { name: "I'll do this" })).toBeVisible();
  await main.getByRole("button", { name: "I'll do this" }).click();

  await expect(main.getByText("you took this on")).toBeVisible();
  const accepted = await db.query<{ status: string }>(
    `SELECT status FROM "Commitment" WHERE id = $1`,
    [commitmentId],
  );
  expect(accepted.rows[0]!.status).toBe("ACCEPTED");

  // Accepting replaces the propose/decline pair with the follow-through moves.
  await expect(main.getByRole("button", { name: "I'll do this" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Done" })).toBeVisible();

  // "Set aside", never "abandoned" or "failed" — dropping something on purpose
  // is a legitimate outcome and the signal a later review reads.
  await main.getByRole("button", { name: "Set aside" }).click();
  await expect(main.getByText("set aside")).toBeVisible();

  const resolved = await db.query<{ status: string; resolvedAt: Date | null }>(
    `SELECT status, "resolvedAt" FROM "Commitment" WHERE id = $1`,
    [commitmentId],
  );
  expect(resolved.rows[0]!.status).toBe("ABANDONED");
  expect(resolved.rows[0]!.resolvedAt).not.toBeNull();

  // Terminal on the server, so no buttons remain to contradict that.
  await expect(main.getByRole("button", { name: "Done" })).toHaveCount(0);
});

test("a commitment can be accepted from the dashboard too", async ({ page }) => {
  const profileId = await signUpAndGetProfile(page, "dashcommit");

  const reviewId = await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "deep-review/v1",
    paceStatus: "ON_PACE",
    thresholdSnapshotJson: JSON.stringify({ band: "gaps to close" }),
    differentiationSnapshotJson: JSON.stringify({ band: "competitive" }),
    resultJson: JSON.stringify(deepReviewNarrative),
  });
  const commitmentId = newId("cm");
  await db.query(
    `INSERT INTO "Commitment"
       (id, "profileId", "sourceEvaluationId", description, status, "dueDate",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'PROPOSED',NULL,NOW(),NOW())`,
    [commitmentId, profileId, reviewId, "Speak to school about Further Maths"],
  );

  await page.goto("/dashboard");
  const main = page.locator("main");
  await expect(main.getByText("Speak to school about Further Maths")).toBeVisible();
  await main.getByRole("button", { name: "I'll do this" }).click();

  await expect(main.getByText("You committed to this.")).toBeVisible();
  const row = await db.query<{ status: string }>(
    `SELECT status FROM "Commitment" WHERE id = $1`,
    [commitmentId],
  );
  expect(row.rows[0]!.status).toBe("ACCEPTED");
});

test("a Deep Review proposes commitments the student can accept", async ({
  page,
}) => {
  // Commitments moved onto the evaluation when the tier was retired, because
  // the tier was their only producer. This is the loop end to end: proposed by
  // a review, answered from the review, tracked in the database.
  const profileId = await signUpAndGetProfile(page, "evalcommit");

  const reviewId = await seedEvaluation({
    profileId,
    promptVersion: "evaluation/v11",
    overallScore: 58,
    resultJson: JSON.stringify({
      overallScore: 58,
      gradeRelativeScore: 81,
      gradeContext: "Two different questions.",
      headline: "A review that asks something of you.",
      summary: "A summary.",
      strengths: [],
      weaknesses: [],
      narrativeCoherence: { score: 70, assessment: "Coherent." },
      schoolFits: [],
      gaps: [],
      verifyThese: [],
      proposedCommitments: [
        { description: "Send the write-up to a teacher", targetRung: null, dueInWeeks: 4 },
        { description: "Enter the olympiad", targetRung: "contributor", dueInWeeks: 8 },
      ],
    }),
  });
  const commitmentId = newId("cm");
  await db.query(
    `INSERT INTO "Commitment"
       (id, "profileId", "sourceEvaluationId", description, status, "dueDate",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'PROPOSED',$5,NOW(),NOW())`,
    [commitmentId, profileId, reviewId, "Send the write-up to a teacher", new Date("2026-10-01")],
  );

  await page.goto(`/evaluations/${reviewId}`);
  const main = page.locator("main");

  // The heading is the new name, and the percentiles are still there.
  await expect(
    page.getByRole("heading", { name: "Deep Review", level: 1 }),
  ).toBeVisible();
  await expect(main.getByText("58").first()).toBeVisible();

  // The commitments card renders on a percentile review — it used to be
  // gated to the retired shape, so this section simply did not exist here.
  await expect(main.getByText("What this review asked of you")).toBeVisible();
  await expect(main.getByText("Send the write-up to a teacher")).toBeVisible();

  await main.getByRole("button", { name: "I'll do this" }).click();
  await expect(main.getByText("you took this on")).toBeVisible();

  const row = await db.query<{ status: string }>(
    `SELECT status FROM "Commitment" WHERE id = $1`,
    [commitmentId],
  );
  expect(row.rows[0]!.status).toBe("ACCEPTED");
});

test("the dashboard keeps showing your scores when the newest run has none", async ({
  page,
}) => {
  // The regression, in the only place it was visible: the dashboard renders
  // whichever standing the NEWEST run produced, so the day a Deep Review
  // arrived the percentiles — and the US/UK split with them — left the screen
  // entirely. Nothing threw, the page still returned 200, and the numbers were
  // simply gone. Only a browser shows that.
  const profileId = await signUpAndGetProfile(page, "carried");

  const legacyId = await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW", // the schema default every legacy row carries
    promptVersion: "evaluation/v10",
    overallScore: 58,
    resultJson: JSON.stringify({
      overallScore: 58,
      gradeRelativeScore: 81,
      gradeContext: "Two different questions.",
      headline: "An evaluation with percentiles.",
      summary: "A summary.",
      systemScores: [
        {
          rubricId: "us_holistic",
          systemLabel: "US",
          readinessScore: 55,
          gradeRelativeScore: 78,
          assessment: "ok",
        },
        {
          rubricId: "uk_course",
          systemLabel: "UK",
          readinessScore: 71,
          gradeRelativeScore: 84,
          assessment: "ok",
        },
      ],
      strengths: [],
      weaknesses: [],
      narrativeCoherence: { score: 70, assessment: "Coherent." },
      schoolFits: [],
      gaps: [],
      verifyThese: [],
    }),
  });
  // Both rows are inserted with NOW(); without this the ordering between them
  // is whatever the clock resolution happens to give, and the test would pass
  // or fail on timing rather than on behaviour.
  await db.query(
    `UPDATE "Evaluation" SET "createdAt" = NOW() - interval '30 days' WHERE id = $1`,
    [legacyId],
  );

  await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "deep-review/v3",
    paceStatus: "ON_PACE",
    thresholdSnapshotJson: JSON.stringify({ band: "gaps to close" }),
    differentiationSnapshotJson: JSON.stringify({ band: "competitive" }),
    resultJson: JSON.stringify(deepReviewNarrative),
  });

  await page.goto("/dashboard");
  const main = page.locator("main");

  // The Deep Review is still the current standing, in bands.
  await expect(main.getByText("physics thread is the one worth")).toBeVisible();
  await expect(main.getByText("gaps to close").first()).toBeVisible();
  await expect(main.getByText("competitive").first()).toBeVisible();

  // And the scores are back, under their own heading, dated and attributed.
  await expect(
    main.getByText("Where your last Deep Review left you"),
  ).toBeVisible();
  await expect(main.getByText("58")).toBeVisible();
  await expect(main.getByText("81")).toBeVisible();

  // The US/UK split survives — losing it was the worst part of the
  // disappearance, since keeping the two apart is the product's whole premise.
  await expect(main.getByText("US:")).toBeVisible();
  await expect(main.getByText("UK:")).toBeVisible();

  // Said in words, on the page: these came from a different run than the one
  // at the top of the card, not a stale copy of what is shown above them.
  await expect(
    main.getByText("come from the Deep Review dated above"),
  ).toBeVisible();

  await page.screenshot({
    path: "test-results/dashboard-carried-scores.png",
    fullPage: true,
  });
});

test("the Check-In button appears only once there is something to check in against", async ({
  page,
}) => {
  const profileId = await signUpAndGetProfile(page, "checkinbtn");

  // A profile with targets and content but no evaluation: the button must not
  // be offered, because a check-in with no baseline still calls the model and
  // charges for a narrative about a fortnight nobody measured.
  await page.goto("/targets/new");
  await page.fill('input[name="name"]', "University of Cambridge");
  await page.selectOption('select[name="country"]', "GB");
  await page.fill('input[name="course"]', "Physics");
  await page.getByRole("button", { name: "Add target" }).click();
  await page.waitForURL("**/targets");

  // Resume content too, or the whole button group is disabled for having
  // nothing to assess — which is correct, and would otherwise make this test
  // pass for the wrong reason.
  await db.query(
    `INSERT INTO "ResumeItem"
       (id, "profileId", type, title, description, "startDate", "hoursPerWeek",
        "createdAt", "updatedAt")
     VALUES ($1,$2,'project',$3,$4,NOW(),4,NOW(),NOW())`,
    [
      newId("ri"),
      profileId,
      "Orbital mechanics simulation",
      "A simulation written over the last year.",
    ],
  );

  await page.goto("/evaluations");
  await expect(
    page.locator("main").getByRole("button", { name: "Run a Check-In" }),
  ).toHaveCount(0);

  // Give them a completed evaluation, and it appears.
  await seedEvaluation({
    profileId,
    type: "DEEP_REVIEW",
    promptVersion: "deep-review/v1",
    paceStatus: "ON_PACE",
    thresholdSnapshotJson: JSON.stringify({ band: "gaps to close" }),
    differentiationSnapshotJson: JSON.stringify({ band: "competitive" }),
    resultJson: JSON.stringify(deepReviewNarrative),
  });
  await page.reload();
  await expect(
    page.locator("main").getByRole("button", { name: "Run a Check-In" }),
  ).toBeVisible();
});

test("a student can report something, and it waits for the next check-in", async ({
  page,
}) => {
  const profileId = await signUpAndGetProfile(page, "dev");

  await page.goto("/dashboard");
  const main = page.locator("main");
  await expect(main.getByText("Recent developments")).toBeVisible();

  await main.getByRole("textbox").first().fill("Asked the mock trial coach — I am prepping a witness next round.");
  await main.getByRole("button", { name: "Save" }).first().click();

  // Shown back, and labelled as queued rather than acted on.
  await expect(main.getByText("prepping a witness next round")).toBeVisible();
  await expect(main.getByText("waiting for your next check-in")).toBeVisible();

  const rows = await db.query<{ body: string; readByEvaluationId: string | null }>(
    `SELECT body, "readByEvaluationId" FROM "Development" WHERE "profileId" = $1`,
    [profileId],
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]!.readByEvaluationId).toBeNull();

  // Taking it back has to work — it is free text written in the moment.
  await main.getByRole("button", { name: "Remove" }).first().click();
  await expect(main.getByText("prepping a witness next round")).toHaveCount(0);
  const after = await db.query(`SELECT 1 FROM "Development" WHERE "profileId" = $1`, [
    profileId,
  ]);
  expect(after.rows).toHaveLength(0);
});

test("a check-in's question can be answered from the check-in itself", async ({
  page,
}) => {
  const profileId = await signUpAndGetProfile(page, "answer");

  const commitmentId = newId("cm");
  await db.query(
    `INSERT INTO "Commitment"
       (id, "profileId", description, status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,'ACCEPTED',NOW(),NOW())`,
    [commitmentId, profileId, "Ask the mock trial coach for a role"],
  );

  const checkInId = await seedEvaluation({
    profileId,
    type: "CHECK_IN",
    promptVersion: "check-in/v3",
    materialChange: true,
    paceStatus: "ON_PACE",
    resultJson: JSON.stringify({
      ...checkInNarrative,
      commitmentPrompts: [
        { commitmentId, question: "Did you ask the coach, and what did they say?" },
      ],
    }),
  });

  await page.goto(`/evaluations/${checkInId}`);
  const main = page.locator("main");

  // The gap this closes: the question was rhetorical until there was a box
  // under it.
  await expect(main.getByText("Did you ask the coach")).toBeVisible();
  await main.getByRole("textbox").first().fill("Yes — they gave me the witness prep.");
  await main.getByRole("button", { name: "Save" }).first().click();
  await expect(main.getByText("your next check-in will read this")).toBeVisible();

  // Stored against the commitment it answers, so the next check-in knows which
  // question is now closed.
  const rows = await db.query<{ commitmentId: string | null }>(
    `SELECT "commitmentId" FROM "Development" WHERE "profileId" = $1`,
    [profileId],
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]!.commitmentId).toBe(commitmentId);
});
