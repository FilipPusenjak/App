// What the document pages render, decided on the server.
//
// LOCKED MEANS LOCKED BEFORE ANY DATA LOADS. For a free account the gate
// returns the synthetic preview and nothing else: the student's documents and
// activities are never read on that path, so the preview cannot carry their
// data even by accident. tests/integration/documents.test.ts checks this for a
// free user with a distinctive activity.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOrCreateProfile } from "@/lib/ownership";
import { documentAccessFor } from "./entitlement";
import { lockedPreview, type LockedPreview } from "./preview";

export type { LockedPreview } from "./preview";

export type DocumentsGate =
  | { locked: true; preview: LockedPreview }
  | { locked: false; userId: string; profileId: string };

export async function documentsGate(): Promise<DocumentsGate> {
  const user = await getCurrentUser();
  if (!user?.id) redirect("/login");
  const profile = await getOrCreateProfile();
  const access = await documentAccessFor(user.id, profile.id);
  if (!access.allowed) return { locked: true, preview: lockedPreview() };
  return { locked: false, userId: user.id, profileId: profile.id };
}
