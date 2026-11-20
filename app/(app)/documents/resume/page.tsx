import Link from "next/link";
import { prisma } from "@/lib/db";
import { documentsGate } from "@/lib/documents/page-data";
import { currentCycle } from "@/lib/documents/limits";
import { getOrCreateDraft, listExports, loadSourceSnapshot } from "@/lib/documents/store";
import type { ResumeFields } from "@/lib/documents/fields";
import { LockedPreview } from "../locked-preview";
import { ResumeEditor } from "./resume-editor";

export const metadata = { title: "Resume" };

export default async function ResumePage() {
  const gate = await documentsGate();
  if (gate.locked) {
    return (
      <div className="space-y-6">
        <Header />
        <LockedPreview preview={gate.preview} focus="resume" />
      </div>
    );
  }

  const cycle = currentCycle();
  const [draft, snapshot, saved, exports] = await Promise.all([
    getOrCreateDraft(gate.profileId, "RESUME_PDF", cycle),
    loadSourceSnapshot(gate.profileId, cycle),
    prisma.savedResumeContact.findUnique({ where: { profileId: gate.profileId } }),
    listExports(gate.profileId, "RESUME_PDF"),
  ]);
  const fields = draft.fields as unknown as ResumeFields;
  const gpa =
    snapshot.student.gpa != null
      ? `${snapshot.student.gpa}${snapshot.student.gpaScale ? ` / ${snapshot.student.gpaScale}` : ""}`
      : null;

  return (
    <div className="space-y-6">
      <Header />
      <ResumeEditor
        skills={fields.skills}
        includeGpa={fields.includeGpa}
        gpa={gpa}
        defaultName={snapshot.student.name ?? ""}
        saved={saved ? { name: saved.name ?? "", email: saved.email ?? "", phone: saved.phone ?? "", address: saved.address ?? "" } : null}
        counts={{ activities: snapshot.activities.length, honors: snapshot.honors.length }}
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
      <h1 className="mt-1 text-2xl font-semibold">One-page resume</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        A plain, single-column PDF that application systems read reliably. Built from your profile; activity
        lines use your Common App descriptions where you have them, otherwise your own facts.
      </p>
    </div>
  );
}
