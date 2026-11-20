"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, Card, downloadPdf, ErrorNote } from "../doc-ui";

type Contact = { name: string; email: string; phone: string; address: string };

const primary =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";
const input =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900";

export function ResumeEditor({
  skills,
  includeGpa,
  gpa,
  defaultName,
  saved,
  counts,
  exports,
}: {
  skills: string[];
  includeGpa: boolean;
  gpa: string | null;
  defaultName: string;
  saved: Contact | null;
  counts: { activities: number; honors: number };
  exports: { id: string; exportedAt: string | null }[];
}) {
  const router = useRouter();
  const [skillText, setSkillText] = useState(skills.join(", "));
  // Prefilled only from what the student chose to have remembered.
  const [contact, setContact] = useState<Contact>(saved ?? { name: defaultName, email: "", phone: "", address: "" });
  const [remember, setRemember] = useState(saved !== null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ dropped: string[]; replaced: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    const res = await api("PATCH", "/api/documents/resume", body);
    if (!res.ok) return setError(res.data.error ?? "Couldn't save.");
    setError(null);
    router.refresh();
  };

  const parsedSkills = skillText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const exportPdf = async () => {
    setExporting(true);
    setResult(null);
    const res = await downloadPdf("/api/documents/resume/export", { contact, remember }, "resume.pdf");
    setExporting(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    let dropped: string[] = [];
    try {
      dropped = JSON.parse(decodeURIComponent(res.headers.get("X-Dropped") ?? "%5B%5D")) as string[];
    } catch {
      // A malformed header only costs the notice, not the download.
    }
    setResult({ dropped, replaced: res.headers.get("X-Replaced-Characters") === "1" });
    router.refresh();
  };

  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement>) => setContact({ ...contact, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <Card
        title="What goes on it"
        subtitle={`${counts.activities} ${counts.activities === 1 ? "activity" : "activities"} and ${counts.honors} ${counts.honors === 1 ? "honor" : "honors"} from your profile, best first. If it runs past one page, the lowest-ranked are left off rather than shrinking the text.`}
      >
        <label className="block text-sm font-medium" htmlFor="skills">
          Skills
        </label>
        <p className="text-xs text-zinc-500">Your own list, separated by commas. Printed exactly as you write them.</p>
        <input
          id="skills"
          className={`${input} mt-1`}
          value={skillText}
          placeholder="e.g. Python, Spanish (conversational), Adobe Illustrator"
          onChange={(e) => setSkillText(e.target.value)}
          onBlur={() => parsedSkills.join("|") !== skills.join("|") && patch({ skills: parsedSkills })}
        />

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeGpa}
            disabled={!gpa}
            onChange={(e) => patch({ includeGpa: e.target.checked })}
          />
          <span>
            Print my GPA{gpa ? ` (${gpa})` : ""}
            <span className="block text-xs text-zinc-500">
              {gpa ? "Off unless you turn it on." : (
                <>
                  No GPA on your profile. <Link href="/profile" className="underline">Add one</Link> to print it.
                </>
              )}
            </span>
          </span>
        </label>
      </Card>

      <Card
        title="Contact details"
        subtitle="Used to draw this PDF and then discarded, unless you ask us to remember them."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Name">
            <input className={input} value={contact.name} onChange={set("name")} autoComplete="name" />
          </Labeled>
          <Labeled label="Email">
            <input className={input} value={contact.email} onChange={set("email")} type="email" autoComplete="email" />
          </Labeled>
          <Labeled label="Phone">
            <input className={input} value={contact.phone} onChange={set("phone")} type="tel" autoComplete="tel" />
          </Labeled>
          <Labeled label="City, state (or full address)">
            <input className={input} value={contact.address} onChange={set("address")} autoComplete="address-level2" />
          </Labeled>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            Remember these for next time
            <span className="block text-xs text-zinc-500">
              {saved
                ? "Saved now. Untick and download to delete them."
                : "Off by default. Nothing above is saved unless you tick this."}
            </span>
          </span>
        </label>
      </Card>

      <Card title="Download">
        <button type="button" className={primary} disabled={exporting} onClick={exportPdf}>
          {exporting ? "Preparing…" : "Download resume (PDF)"}
        </button>
        <ErrorNote message={error} />
        {result && result.dropped.length > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            To keep it to one page at a readable size, these were left off: {result.dropped.join(", ")}.
          </p>
        )}
        {result?.replaced && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Some characters (such as emoji or non-Latin letters) can&apos;t be drawn in the standard PDF font and
            appear as “?”. Check the download.
          </p>
        )}
        {exports.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {exports.map((e) => (
              <li key={e.id}>
                <Link href={`/documents/exports/${e.id}`} className="underline underline-offset-2">
                  Exported {e.exportedAt ? new Date(e.exportedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}
