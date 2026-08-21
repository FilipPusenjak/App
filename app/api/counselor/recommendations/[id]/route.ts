// PATCH /api/counselor/recommendations/:id — deliver one, or set it aside.
//
// The smallest route in the counselor edition and the one that records the most
// valuable thing in it. A model drafted several options; a professional read
// them and chose. DECLINED_BY_COUNSELOR is a judgement nothing else in this
// product makes, and this endpoint is the only place it is written down.
//
// Access is scoped the same way every counselor read is — through
// readableLinkWhere inside setRecommendationStatus, so a recommendation on
// another counselor's caseload, or one whose consent has lapsed, is not
// rejected but simply not found.
import { NextResponse } from "next/server";
import { z } from "zod";
import { setRecommendationStatus } from "@/lib/counselor/recommendations";
import { recommendationStatusSchema } from "@/lib/validation/counselor";

const bodySchema = z.object({
  status: recommendationStatusSchema,
  /**
   * Optional, and worth having. "Not right for this student yet" from someone
   * who has met them is the single most informative sentence in this table.
   */
  declineReason: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const result = await setRecommendationStatus({
    recommendationId: id,
    next: parsed.data.status,
    declineReason: parsed.data.declineReason,
  }).catch(() => null);

  // A thrown error here means the signed-in account is not a counselor at all.
  if (!result) {
    return NextResponse.json(
      { error: "This account is not a counselor account." },
      { status: 403 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "Not found." ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true, status: parsed.data.status });
}
