import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { documentsGate } from "@/lib/documents/page-data";
import type { CommonAppFields, ResumeFields } from "@/lib/documents/fields";
import type { SourceSnapshot } from "@/lib/documents/store";
import { charCount, gradesPhrase, RECOGNITION_LABELS, TIMING_LABELS, type Timing } from "@/lib/documents/limits";
import type { ResumeContent } from "@/lib/documents/resume-pdf";
import { LockedPreview } from "../../locked-preview";
import { CharCount, CopyButton } from "../../doc-ui";

export const metadata = { title: "Export" };

const TYPE_LABEL: Record<string, string> = {
  COMMON_APP_ACTIVITIES: "Common App activities & honors",
  BRAG_SHEET: "Brag sheet",
  RESUME_PDF: "Resume",
};

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await documentsGate();
  if (gate.locked) return <LockedPreview preview={gate.preview} />;

  const { id } = await params;
  // Scoped to the current student: someone else's export id is simply not found.
  const doc = await prisma.applicationDocument.findFirst({
    where: { id, profileId: gate.profileId, status: "EXPORTED" },
  });
  if (!doc) notFound();
  const snapshot = doc.sourceSnapshot as unknown as SourceSnapshot;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/documents" className="text-sm text-zinc-500 hover:underline">
          ← Documents
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{TYPE_LABEL[doc.type] ?? doc.type}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Exported {doc.exportedAt?.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} · {doc.cycle} cycle.
          This is saved exactly as it was then; later profile changes don&apos;t alter it.
        </p>
      </div>

      {doc.type === "COMMON_APP_ACTIVITIES" ? (
        <CommonAppExport fields={doc.fields as unknown as CommonAppFields} snapshot={snapshot} />
      ) : (
        <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
          <a
            href={`/api/documents/exports/${doc.id}/pdf`}
            className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Download PDF again
          </a>
          {doc.type === "RESUME_PDF" && (
            <ResumeSummary fields={doc.fields as unknown as ResumeFields & { printed?: Omit<ResumeContent, "contact">; droppedActivityIds?: string[] }} />
          )}
        </section>
      )}
    </div>
  );
}

function ResumeSummary({
  fields,
}: {
  fields: ResumeFields & { printed?: Omit<ResumeContent, "contact">; droppedActivityIds?: string[] };
}) {
  return (
    <div className="mt-4 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        Contact details aren&apos;t stored with an export. A re-download uses the details you asked us to remember, or just
        your name.
      </p>
      {fields.printed && (
        <>
          <p className="mt-3 font-medium">Activities on the page</p>
          <ul className="mt-1 list-disc pl-5">
            {fields.printed.activities.map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CommonAppExport({ fields, snapshot }: { fields: CommonAppFields; snapshot: SourceSnapshot }) {
  const byId = new Map(snapshot.activities.map((a) => [a.id, a]));
  const limits = snapshot.limits;
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Activities</h2>
        {fields.order.map((id, i) => {
          const a = byId.get(id);
          const e = fields.entries[id];
          if (!a || !e) return null;
          return (
            <article key={id} className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
              <h3 className="font-semibold">
                <span className="mr-2 tabular-nums text-zinc-400">{i + 1}</span>
                {a.title}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {[
                  a.commonAppType,
                  a.gradeLevels.length ? gradesPhrase(a.gradeLevels) : null,
                  a.timing ? TIMING_LABELS[a.timing as Timing] : null,
                  a.hoursPerWeek != null ? `${a.hoursPerWeek} hr/wk` : null,
                  a.weeksPerYear != null ? `${a.weeksPerYear} wk/yr` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Position / leadership" text={e.position} limit={limits.position} />
                <Row label="Organization name" text={e.organization} limit={limits.organization} />
                <Row label="Description" text={e.description} limit={limits.description} />
              </dl>
            </article>
          );
        })}
      </section>

      {snapshot.honors.length > 0 && (
        <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold">Honors</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {snapshot.honors.slice(0, limits.maxHonors).map((h) => (
              <li key={h.id}>
                <Row
                  label={[RECOGNITION_LABELS[h.recognitionLevel], h.gradeLevels.length ? gradesPhrase(h.gradeLevels) : null]
                    .filter(Boolean)
                    .join(" · ")}
                  text={h.title}
                  limit={limits.honorTitle}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function Row({ label, text, limit }: { label: string; text: string; limit: number }) {
  return (
    <div>
      <dt className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        {label}
        <span className="flex items-center gap-2">
          <CharCount count={charCount(text)} limit={limit} />
          <CopyButton text={text} />
        </span>
      </dt>
      <dd className={text ? "" : "text-zinc-400"}>{text || "(blank)"}</dd>
    </div>
  );
}
