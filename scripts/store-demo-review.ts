// The written Deep Review behind the store screenshots. LOCAL DATABASE ONLY.
//
//   npx tsx scripts/store-demo-review.ts render okonkwo@coursechart-demo.invalid <dir>
//   npx tsx scripts/store-demo-review.ts store  okonkwo@coursechart-demo.invalid - mobile/store/demo-review-okonkwo.json
//
// scripts/seed-demo.ts gives its fictional students scores but no written
// review, so without this the evaluation screens in the screenshots would be
// empty. `render` writes out the exact prompt the Deep Review route would send
// for that student; mobile/store/demo-review-okonkwo.json is a review written
// from that prompt by Claude, the model the route uses for first reviews.
// `store` validates it with the route's own schema (the same length ceilings
// and enum checks a real response gets) and saves it as a completed review.
//
// Then: npx next start -p 3100, and node scripts/store-screenshots.mjs.
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { mergeItemAssessments, NO_REUSE } from "@/lib/evaluation/item-reuse";
import { serializeChartPoint, toChartPoint } from "@/lib/evaluation/chart-point";
import { recordProposedCommitments } from "@/lib/commitments/store";
import { SYSTEM_PROMPT, buildUserPromptParts, PROMPT_VERSION } from "@/lib/prompts/evaluation";
import { evaluationOutputSchema, evaluationWireSchema, fromWireResult } from "@/lib/validation/evaluation-wire";
import { parseModelJson, renderSchemaInstructions } from "@/lib/structured-output";
import type { EvaluationResult } from "@/lib/validation/evaluation";

const [mode, email, dir, file] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("127.0.0.1")) throw new Error("local database only");

async function load() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { profiles: true } });
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: user.profiles[0]!.id },
    include: {
      testScores: { orderBy: { createdAt: "asc" } },
      resumeItems: { orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] },
      targetSchools: { orderBy: { createdAt: "asc" } },
    },
  });
  const snapshot = buildSnapshot(profile, profile.countryOfOrigin ?? user.countryOfOrigin ?? null);
  return { user, profile, snapshot };
}

async function main() {
  const { profile, snapshot } = await load();
  if (mode === "render") {
    mkdirSync(dir, { recursive: true });
    const reqs = await findRequirementsForTargets(snapshot.targets);
    const prompt = buildUserPromptParts(snapshot, null, NO_REUSE, reqs, { developments: [], openCommitments: [] });
    writeFileSync(`${dir}/1-system.txt`, SYSTEM_PROMPT);
    writeFileSync(`${dir}/2-stable.txt`, prompt.stable);
    writeFileSync(`${dir}/3-variable.txt`, prompt.variable);
    writeFileSync(`${dir}/4-schema.txt`, renderSchemaInstructions(zodOutputFormat(evaluationWireSchema).schema));
    console.log("rendered", PROMPT_VERSION, profile.studentName);
    return;
  }
  if (mode === "store") {
    const text = readFileSync(file, "utf8");
    const outcome = parseModelJson(evaluationOutputSchema, { text, constrained: false, stopReason: "end_turn" } as never, "demo review");
    if (!outcome.ok) { console.error("INVALID:", outcome.reason ?? outcome); process.exit(1); }
    const flattened = fromWireResult(outcome.data);
    const result: EvaluationResult = { ...flattened, itemAssessments: mergeItemAssessments(snapshot, flattened.itemAssessments, NO_REUSE) };
    const ev = await prisma.evaluation.create({
      data: {
        profileId: profile.id, status: "completed", promptVersion: PROMPT_VERSION, model: "claude-opus-5-5",
        isSample: false, inputSnapshotJson: JSON.stringify(snapshot), resultJson: JSON.stringify(result),
        overallScore: Math.round(result.overallScore),
        chartPointJson: serializeChartPoint(toChartPoint(result, Math.round(result.overallScore))),
        completedAt: new Date(),
      },
    });
    await recordProposedCommitments({
      profileId: profile.id, evaluationId: ev.id,
      proposals: result.proposedCommitments.map((c) => ({ description: c.description, targetRung: c.targetRung ?? null, dueInWeeks: c.dueInWeeks })),
    });
    console.log("stored", ev.id, "overall", result.overallScore);
  }
}
main().finally(() => prisma.$disconnect());
