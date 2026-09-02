// POST /api/counselor/prep — draft one student's session prep.
//
// ON DEMAND, FOR ONE STUDENT. There is deliberately no batch endpoint: the
// brief forbids bulk-generating prep for a caseload, and the economics say the
// same thing from the other side. Triage is free because it calls no model, so
// a counselor monitors forty students for nothing and generates prep for the
// eight that surfaced. A "prepare everyone" button would multiply the only
// per-student cost in the product by five.
//
// Every guard the student routes have, plus the ones only this surface needs:
// the link must be readable (dual consent, ACTIVE, this counselor's), the read
// is logged, the caseload limit is enforced server-side, and the output is
// checked for probability phrasing before it can reach a counselor's screen.
import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  getAnthropicClient,
  getFollowupEffort,
  getFollowupModel,
} from "@/lib/anthropic";
import type { Effort } from "@/lib/evaluation/model-choice";
import { evaluationRateLimiter } from "@/lib/rate-limit";
import { estimateCost } from "@/lib/cost";
import {
  MIN_USEFUL_OUTPUT_TOKENS,
  RUN_BUDGET_USD,
  estimateInputTokens,
  maxOutputTokensFor,
} from "@/lib/cost-budget";
import {
  findReadableLink,
  logCounselorRead,
  requireCounselorAccount,
} from "@/lib/counselor/access";
import { buildPrepContext } from "@/lib/counselor/prep/context";
import {
  SESSION_PREP_PROMPT_VERSION,
  SESSION_PREP_SYSTEM_PROMPT,
  buildSessionPrepUserPrompt,
} from "@/lib/prompts/counselor/session-prep-v1";
import {
  findBannedCounselorPhrasing,
  sessionPrepNarrativeSchema,
} from "@/lib/validation/counselor";
import { SOURCE_DATA_VERSION } from "@/lib/evaluation/tier-load";

export const maxDuration = 120;

const OUTPUT_FORMAT = zodOutputFormat(sessionPrepNarrativeSchema);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const account = await requireCounselorAccount().catch(() => null);
  if (!account) {
    return NextResponse.json(
      { error: "This account is not a counselor account." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    linkId?: unknown;
  } | null;
  const linkId = typeof body?.linkId === "string" ? body.linkId : null;
  if (!linkId) {
    return NextResponse.json({ error: "Which student?" }, { status: 400 });
  }

  // Resolved against this counselor's readable links rather than trusted. A
  // link belonging to someone else, or one whose consent has lapsed, is not
  // rejected — it does not exist to this request.
  const link = await findReadableLink(linkId);
  if (!link) {
    return NextResponse.json(
      { error: "No access to that student." },
      { status: 404 },
    );
  }

  // Caseload limit, server-side. Costs scale with caseload, so an unbounded
  // caseload is an unbounded bill, and a limit enforced only in the UI is not
  // a limit.
  const activeCount = await prisma.caseloadLink.count({
    where: { counselorAccountId: account.id, status: "ACTIVE", endedAt: null },
  });
  if (activeCount > account.caseloadLimit) {
    return NextResponse.json(
      {
        error: `This plan covers ${account.caseloadLimit} active students and you have ${activeCount}. Prep is paused until the caseload is inside the limit or the plan is raised.`,
      },
      { status: 402 },
    );
  }

  const limit = await evaluationRateLimiter.check(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many runs for now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json(
      { error: "No API key configured, so prep cannot be drafted." },
      { status: 503 },
    );
  }

  const context = await buildPrepContext(link);

  // Generating prep IS a read of student data, and is logged as one. A read
  // that produced a document is more consequential than one that rendered a
  // list, not less.
  await logCounselorRead({ link, surface: "prep.generate" });

  const model = getFollowupModel() ?? "claude-sonnet-5";
  const userPrompt = buildSessionPrepUserPrompt(context.text);

  // Same construction as the student routes: the allowance is what remains of
  // the budget after the prompt is paid for, so the ceiling holds by arithmetic
  // rather than by watching. This route sends no cache_control.
  const promptTokens = estimateInputTokens(SESSION_PREP_SYSTEM_PROMPT, userPrompt);
  const allowance = maxOutputTokensFor({
    budgetUsd: RUN_BUDGET_USD.SESSION_PREP,
    inputTokens: promptTokens,
    model,
    cachesInput: false,
  });

  if (allowance < MIN_USEFUL_OUTPUT_TOKENS.SESSION_PREP) {
    return NextResponse.json(
      {
        error: `This student assembles a ${promptTokens.toLocaleString()}-token context, which leaves too little of the $${RUN_BUDGET_USD.SESSION_PREP.toFixed(2)} per-prep budget for the prep itself. Raise SESSION_PREP_BUDGET_USD or reduce what the prep is given.`,
      },
      { status: 507 },
    );
  }

  const message = await client.messages.create({
    model,
    max_tokens: allowance,
    system: SESSION_PREP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: OUTPUT_FORMAT, effort: getFollowupEffort() as Effort },
  });

  // Read usage BEFORE anything can reject the output. Everything below is a
  // path where the tokens are already spent, and the cost is owed to the record
  // whether or not the prep was usable.
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  const base = {
    caseloadLinkId: link.id,
    counselorAccountId: account.id,
    rubricVersion: context.rubricVersion,
    promptVersion: SESSION_PREP_PROMPT_VERSION,
    sourceDataVersion: SOURCE_DATA_VERSION,
    modelUsed: model,
    triageSignalIds: context.signalIds,
    ...usage,
    costCents: Math.round((estimateCost(usage, model) ?? 0) * 100),
  };

  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = sessionPrepNarrativeSchema.safeParse(safeJson(text));

  if (!parsed.success) {
    const row = await prisma.sessionPrep.create({
      data: {
        ...base,
        error:
          "The prep came back in a shape the app could not read, so it was discarded. This run still cost what it used — that cost is recorded here.",
      },
    });
    return NextResponse.json(
      { id: row.id, error: "The prep came back in a shape we could not read." },
      { status: 502 },
    );
  }

  // Last line of defence on the rule that matters most here. A counselor
  // repeating a model-generated probability to a fee-paying parent is a
  // professional liability, so a prep containing one is refused rather than
  // shown — and the attempt is still recorded with what it cost.
  const banned = findBannedCounselorPhrasing(parsed.data);
  if (banned.length > 0) {
    const row = await prisma.sessionPrep.create({
      data: {
        ...base,
        error: `The prep was discarded for containing ${banned.join(", ")}. This product never states odds of admission. This run still cost what it used — that cost is recorded here.`,
      },
    });
    return NextResponse.json(
      {
        id: row.id,
        error: "The prep contained disallowed phrasing and was discarded.",
      },
      { status: 502 },
    );
  }

  const prep = await prisma.sessionPrep.create({
    data: { ...base, narrative: parsed.data },
  });

  // The model's suggestions become PROPOSED recommendations — a record of what
  // was offered, so that what the counselor chose NOT to pass on is captured
  // too. That judgement is the one thing in this product the model never makes.
  if (parsed.data.optionsToConsider.length > 0) {
    await prisma.counselorRecommendation.createMany({
      data: parsed.data.optionsToConsider.map((o) => ({
        sessionPrepId: prep.id,
        caseloadLinkId: link.id,
        text: o.option,
        basis: o.basis,
        source: "MODEL_SUGGESTED",
        status: "PROPOSED",
      })),
    });
  }

  return NextResponse.json({ id: prep.id, narrative: parsed.data });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
