import Link from "next/link";
import { documentsGate } from "@/lib/documents/page-data";
import { currentCycle } from "@/lib/documents/limits";
import { getOrCreateDraft, listExports, loadSourceSnapshot } from "@/lib/documents/store";
import { BRAG_TEMPLATES } from "@/lib/documents/brag-sheet";
import type { BragSheetFields } from "@/lib/documents/fields";
import { hasAiConsent } from "@/lib/ai-consent";
import { getAnthropicClient } from "@/lib/anthropic";
import { LockedPreview } from "../locked-preview";
import { BragSheetEditor } from "./brag-sheet-editor";

export const metadata = { title: "Brag sheet" };

export default async function BragSheetPage() {
  const gate = await documentsGate();
  if (gate.locked) {
    return (
      <div className="space-y-6">
        <Header />
        <LockedPreview preview={gate.preview} focus="brag-sheet" />
      </div>
    );
  }

  const cycle = currentCycle();
  const [draft, snapshot, aiConsented, exports] = await Promise.all([
    getOrCreateDraft(gate.profileId, "BRAG_SHEET", cycle),
    loadSourceSnapshot(gate.profileId, cycle),
    hasAiConsent(gate.userId),
    listExports(gate.profileId, "BRAG_SHEET"),
  ]);

  return (
    <div className="space-y-6">
      <Header />
      <BragSheetEditor
        fields={draft.fields as unknown as BragSheetFields}
        templates={BRAG_TEMPLATES}
        included={{
          activities: snapshot.activities.length,
          courses: snapshot.courses.length,
          testScores: snapshot.testScores.length,
          targets: snapshot.targets.length,
          hasGpa: snapshot.student.gpa != null,
        }}
        aiConsented={aiConsented}
        aiAvailable={getAnthropicClient() !== null}
        exports={exports.map((e) => ({ id: e.id, exportedAt: e.exportedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}

function Header() {
  return (
    <div>
      <Link href="/documents" className="text-sm text-zinc-500 hover:underline">
        ← Documents
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Brag sheet</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        For the teachers and counselor writing your recommendations. Your activities and academics come from
        your profile; the stories are yours, saved exactly as you write them.
      </p>
    </div>
  );
}
