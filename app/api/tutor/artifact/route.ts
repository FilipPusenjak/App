// POST /api/tutor/artifact — draft one student's progress update for a parent.
//
// The only route in the test-prep edition that calls a model, and it calls it
// once. Target derivation, section allocation and the stopping engine all ran
// before this and called nothing.
//
// THE GATE THAT MATTERS is the mandatory stopping notice. When the engine has
// fired, an artifact whose stoppingNotice is null is REFUSED and the tokens are
// written off — because the alternative is a parent-facing document that
// silently omits the one fact that would end the engagement, which is the exact
// failure this product exists to refuse. The model is told twice; this is what
// makes it true.
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
import { requireCounselorAccount, logCounselorRead } from "@/lib/counselor/access";
import { findTutorLink } from "@/lib/testprep/access";
import { buildProgressContext } from "@/lib/testprep/progress-context";
import {
  PROGRESS_PROMPT_VERSION,
  PROGRESS_SYSTEM_PROMPT,
} from "@/lib/prompts/testprep/progress-v1";
import {
  artifactOmitsRequiredStoppingNotice,
  findBannedPredictionPhrasing,
  progressNarrativeSchema,
} from "@/lib/validation/testprep";
import { caseloadStanding } from "@/lib/testprep/entitlement";

export const maxDuration = 120;

const OUTPUT_FORMAT = zodOutputFormat(progressNarrativeSchema);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const account = await requireCounselorAccount().catch(() => null);
  if (!account) {
    return NextResponse.json(
      { error: "This account is not a tutor account." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    linkId?: unknown;
    testTypeId?: unknown;
    periodStart?: unknown;
    periodEnd?: unknown;
  } | null;

  const linkId = typeof body?.linkId === "string" ? body.linkId : null;
  const testTypeId = typeof body?.testTypeId === "string" ? body.testTypeId : null;
  if (!linkId || !testTypeId) {
    return NextResponse.json(
      { error: "Which student, and which test?" },
      { status: 400 },
    );
  }

  // Resolved against this tutor's own readable links rather than trusted, and
  // additionally required to be TEST_PREP_ONLY — a wider link is a counselor's,
  // and this route is not theirs.
  const link = await findTutorLink(linkId);
  if (!link) {
    return NextResponse.json({ error: "No access to that student." }, { status: 404 });
  }

  const periodEnd =
    typeof body?.periodEnd === "string" ? new Date(body.periodEnd) : new Date();
  const periodStart =
    typeof body?.periodStart === "string"
      ? new Date(body.periodStart)
      : new Date(periodEnd.getTime() - 30 * 86_400_000);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ error: "Unreadable period." }, { status: 400 });
  }

  /* ── Entitlement, SOFTLY ────────────────────────────────────────────────
     Over the caseload band, a tutor is notified and asked to choose. They are
     never auto-upgraded and a session in progress is never broken — so this
     does NOT refuse the request. It reports the standing alongside the result
     and lets the tutor decide. */
  const standing = await caseloadStanding(account.id);

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
      { error: "No API key configured, so an update cannot be drafted." },
      { status: 503 },
    );
  }

  const built = await buildProgressContext({
    link,
    testTypeId,
    periodStart,
    periodEnd,
  });
  if (!built) {
    return NextResponse.json(
      { error: "That test is not set up, so no update can be drafted." },
      { status: 400 },
    );
  }

  // Drafting an artifact IS a read of student data, and is logged as one.
  await logCounselorRead({ link, surface: "tutor.artifact" });

  const model = getFollowupModel() ?? "claude-sonnet-5";

  // Same construction as every other generated surface: the output allowance is
  // what remains of the budget once the prompt is paid for, so the ceiling holds
  // by arithmetic rather than by watching. This route sends no cache_control —
  // a monthly artifact cannot land inside a cache TTL.
  const promptTokens = estimateInputTokens(PROGRESS_SYSTEM_PROMPT, built.text);
  const allowance = maxOutputTokensFor({
    budgetUsd: RUN_BUDGET_USD.PROGRESS_ARTIFACT,
    inputTokens: promptTokens,
    model,
    cachesInput: false,
  });
  if (allowance < MIN_USEFUL_OUTPUT_TOKENS.PROGRESS_ARTIFACT) {
    return NextResponse.json(
      {
        error: `This student assembles a ${promptTokens.toLocaleString()}-token brief, which leaves too little of the $${RUN_BUDGET_USD.PROGRESS_ARTIFACT.toFixed(2)} budget for the update itself. Raise PROGRESS_ARTIFACT_BUDGET_USD or shorten the period.`,
      },
      { status: 507 },
    );
  }

  const message = await client.messages.create({
    model,
    max_tokens: allowance,
    system: PROGRESS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: built.text }],
    output_config: { format: OUTPUT_FORMAT, effort: getFollowupEffort() as Effort },
  });

  // Usage read BEFORE anything can reject the output. Everything below is a path
  // where the tokens are already spent.
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  const base = {
    studentUserId: link.studentUserId,
    caseloadLinkId: link.id,
    periodStart,
    periodEnd,
    rubricVersion: built.rubricVersion,
    sourceDataVersion: built.sourceDataVersion,
    promptVersion: PROGRESS_PROMPT_VERSION,
    modelUsed: model,
    ...usage,
    costCents: Math.round((estimateCost(usage, model) ?? 0) * 100),
  };

  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = progressNarrativeSchema.safeParse(safeJson(text));

  if (!parsed.success) {
    const row = await prisma.progressArtifact.create({
      data: {
        ...base,
        error:
          "The update came back in a shape the app could not read, so it was discarded. This run still cost what it used — that cost is recorded here.",
      },
    });
    return NextResponse.json(
      { id: row.id, error: "The update came back in a shape we could not read." },
      { status: 502 },
    );
  }

  /* ── The mandatory notice ───────────────────────────────────────────────
     A signal fired and the artifact does not carry it. Refused outright: this
     document goes to a parent paying by the hour, and one that omits the reason
     to stop is worse than no document at all. */
  if (
    artifactOmitsRequiredStoppingNotice({
      firedKinds: built.firedKinds,
      narrative: parsed.data,
    })
  ) {
    const row = await prisma.progressArtifact.create({
      data: {
        ...base,
        error: `A stopping signal (${built.firedKinds.join(", ")}) has fired and the update omitted it, so it was discarded. A parent-facing update must carry the reason to stop. This run still cost what it used — that cost is recorded here.`,
      },
    });
    return NextResponse.json(
      {
        id: row.id,
        error:
          "The update left out the stopping notice and was discarded. Try again.",
      },
      { status: 502 },
    );
  }

  /* ── The phrasing gate ──────────────────────────────────────────────────
     Last line of defence on the rule that would hurt this family most. A
     predicted score in a document a parent keeps becomes a promise the tutor
     answers for months later. */
  const banned = findBannedPredictionPhrasing(parsed.data);
  if (banned.length > 0) {
    const row = await prisma.progressArtifact.create({
      data: {
        ...base,
        error: `The update was discarded for containing ${banned.join(", ")}. This product never predicts a future score. This run still cost what it used — that cost is recorded here.`,
      },
    });
    return NextResponse.json(
      { id: row.id, error: "The update contained disallowed phrasing and was discarded." },
      { status: 502 },
    );
  }

  const artifact = await prisma.progressArtifact.create({
    data: { ...base, narrative: { ...parsed.data, computed: built.computed } },
  });

  return NextResponse.json({
    id: artifact.id,
    narrative: parsed.data,
    computed: built.computed,
    // Reported, never enforced. The tutor chooses what to do about it.
    caseload: standing.overBand
      ? {
          overBand: true,
          active: standing.active,
          limit: standing.limit,
          message: standing.message,
        }
      : null,
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
