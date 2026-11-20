// The student confirming (or changing) which activities go on the list and in
// what order. The only way the order of a confirmed list ever changes.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import { validateOrder, type CommonAppFields } from "@/lib/documents/fields";
import { refreshCommonAppDraft, saveDraft } from "@/lib/documents/store";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

export async function PUT(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  const order = Array.isArray(body.order) && body.order.every((x) => typeof x === "string")
    ? (body.order as string[])
    : null;
  if (!order) return badRequest("Send the list as an ordered array of activity ids.");

  const draft = await refreshCommonAppDraft(gate.profileId, currentCycle());
  const snapshot = draft.sourceSnapshot;
  const valid = validateOrder(order, snapshot.activities.map((a) => a.id), snapshot.limits.maxActivities);
  if (!valid.ok) return badRequest(valid.message);

  const fields: CommonAppFields = { ...(draft.fields as CommonAppFields), order };
  try {
    await saveDraft(draft.id, { fields, orderConfirmedAt: new Date() });
  } catch (err) {
    return handleStoreError(err);
  }
  return NextResponse.json({ ok: true, order });
}
