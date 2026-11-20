// Generate (or regenerate) Common App descriptions: the whole list, or one entry.
//
// Paid, signed in, AI permission given — in that order, all on the server.
// Then generate.ts does the work: cached entries cost nothing, edited ones are
// never touched, and everything the model writes is length- and
// fidelity-checked before it lands.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { hasAiConsent, ownConsentRequired } from "@/lib/ai-consent";
import { getAnthropicClient, getDocumentModel } from "@/lib/anthropic";
import { currentCycle } from "@/lib/documents/limits";
import { generateCommonAppDescriptions } from "@/lib/documents/generate";
import type { MessagesClient } from "@/lib/documents/compress";
import { readJson } from "@/lib/documents/http";

export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  if (!(await hasAiConsent(gate.userId))) return ownConsentRequired();

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json(
      { error: "AI isn't connected on this deployment, so descriptions can't be generated. Every field can still be written by hand." },
      { status: 503 },
    );
  }

  const body = await readJson(request);
  const activityId = typeof body.activityId === "string" ? body.activityId : null;

  const outcome = await generateCommonAppDescriptions({
    profileId: gate.profileId,
    cycle: currentCycle(),
    activityId,
    client: client as unknown as MessagesClient,
    model: getDocumentModel(),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome);
}
