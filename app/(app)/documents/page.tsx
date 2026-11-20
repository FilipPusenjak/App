import Link from "next/link";
import { documentsGate } from "@/lib/documents/page-data";
import { listExports } from "@/lib/documents/store";
import { currentCycle } from "@/lib/documents/limits";
import { LockedPreview } from "./locked-preview";

export const metadata = { title: "Documents" };

const TYPE_LABEL: Record<string, string> = {
  COMMON_APP_ACTIVITIES: "Common App activities",
  BRAG_SHEET: "Brag sheet",
  RESUME_PDF: "Resume",
};

const DOCS = [
  {
    href: "/documents/common-app",
    title: "Common App activities & honors",
    body: "Your activities list with every field sized to the Common App's limits, ready to copy in. You choose and confirm the order.",
  },
  {
    href: "/documents/brag-sheet",
    title: "Brag sheet",
    body: "A summary for the teachers and counselor writing your recommendations, with your own stories in your own words.",
  },
  {
    href: "/documents/resume",
    title: "One-page resume",
    body: "A plain, one-page PDF that application systems can read. Contact details are only kept if you ask.",
  },
];

export default async function DocumentsPage() {
  const gate = await documentsGate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Application documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Built from your profile and nothing else. Wording can be shortened to fit a field, but nothing
          is ever added: no numbers, titles or results you didn&apos;t enter. US applications, {currentCycle()} cycle.
        </p>
      </div>

      {gate.locked ? (
        <LockedPreview preview={gate.preview} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {DOCS.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="rounded-xl border border-black/10 bg-white p-5 shadow-sm transition hover:border-black/25 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/30"
              >
                <h2 className="font-semibold">{d.title}</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{d.body}</p>
              </Link>
            ))}
          </div>
          <PastExports profileId={gate.profileId} />
        </>
      )}
    </div>
  );
}

async function PastExports({ profileId }: { profileId: string }) {
  const exports = await listExports(profileId);
  if (exports.length === 0) return null;
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold">Past exports</h2>
      <p className="mt-0.5 text-sm text-zinc-500">Each one is saved exactly as it was when you exported it.</p>
      <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/10">
        {exports.slice(0, 20).map((e) => (
          <li key={e.id} className="flex items-center justify-between py-2">
            <span>
              {TYPE_LABEL[e.type] ?? e.type}
              <span className="ml-2 text-zinc-500">{e.exportedAt?.toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
            </span>
            <Link href={`/documents/exports/${e.id}`} className="text-sm font-medium underline underline-offset-2">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
