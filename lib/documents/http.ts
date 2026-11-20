// Small helpers shared by the document builder's routes.
import { NextResponse } from "next/server";
import { ExportedDocumentError } from "./store";

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** Map the store's immutability refusal to a 409, and rethrow anything else. */
export function handleStoreError(err: unknown) {
  if (err instanceof ExportedDocumentError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  throw err;
}
