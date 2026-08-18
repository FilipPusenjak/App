// DELETE /api/developments/:id
//
// Taking it back matters. This is free text a minor wrote about their own life,
// often in the moment, and being able to remove it is part of what makes it
// safe to write at all. Ownership is in the WHERE clause: another account's
// note does not exist to this request rather than being refused.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { deleteDevelopment } from "@/lib/developments";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await context.params;
  const removed = await deleteDevelopment(id);
  if (!removed) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
