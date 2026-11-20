import Link from "next/link";
import { documentsGate } from "@/lib/documents/page-data";
import { currentCycle } from "@/lib/documents/limits";
import { listExports, refreshCommonAppDraft } from "@/lib/documents/store";
import { commonAppView } from "@/lib/documents/view";
import { capDecision, runsThisMonth } from "@/lib/documents/caps";
import type { CommonAppFields } from "@/lib/documents/fields";
import { hasAiConsent } from "@/lib/ai-consent";
import { getAnthropicClient } from "@/lib/anthropic";
import { LockedPreview } from "../locked-preview";
import { CommonAppBuilder } from "./common-app-builder";

export const metadata = { title: "Common App activities" };

export default async function CommonAppPage() {
  const gate = await documentsGate();
  if (gate.locked) {
    return (
      <div className="space-y-6">
        <Header />
        <LockedPreview preview={gate.preview} focus="common-app" />
      </div>
    );
  }

  const draft = await refreshCommonAppDraft(gate.profileId, currentCycle());
  const [aiConsented, listRuns, exports] = await Promise.all([
    hasAiConsent(gate.userId),
    runsThisMonth({ profileId: gate.profileId, scope: "LIST" }),
    listExports(gate.profileId, "COMMON_APP_ACTIVITIES"),
  ]);
  const view = commonAppView({
    fields: draft.fields as CommonAppFields,
    snapshot: draft.sourceSnapshot,
    editedFieldKeys: draft.editedFieldKeys,
    orderConfirmed: draft.orderConfirmedAt !== null,
  });
  const cap = capDecision("LIST", listRuns);

  return (
    <div className="space-y-6">
      <Header />
      {Object.keys(view.activities).length === 0 ? (
        <section className="rounded-xl border border-black/10 bg-white p-5 text-sm shadow-sm dark:border-white/15 dark:bg-white/5">
          <p>There are no activities on your profile yet.</p>
          <Link href="/profile/items/new" className="mt-2 inline-block font-medium underline underline-offset-2">
            Add an activity
          </Link>
        </section>
      ) : (
        <CommonAppBuilder
          view={view}
          aiConsented={aiConsented}
          aiAvailable={getAnthropicClient() !== null}
          listRunsRemaining={cap.ok ? cap.remaining : 0}
          exports={exports.map((e) => ({ id: e.id, exportedAt: e.exportedAt?.toISOString() ?? null }))}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <Link href="/documents" className="text-sm text-zinc-500 hover:underline">
        ← Documents
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Common App activities &amp; honors</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Built from your profile. Descriptions are your own words, shortened to fit. Anything you edit here
        is yours and is never rewritten.
      </p>
    </div>
  );
}
