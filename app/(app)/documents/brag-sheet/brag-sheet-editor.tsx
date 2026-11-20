"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useAiConsentGate } from "@/components/ai-consent-panel";
import type { BragTemplate } from "@/lib/documents/brag-sheet";
import type { BragSheetFields } from "@/lib/documents/fields";
import { api, Card, downloadPdf, ErrorNote } from "../doc-ui";

const btn =
  "rounded-md border border-black/15 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const primary =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";

export function BragSheetEditor({
  fields,
  templates,
  included,
  aiConsented,
  aiAvailable,
  exports,
}: {
  fields: BragSheetFields;
  templates: BragTemplate[];
  included: { activities: number; courses: number; testScores: number; targets: number; hasGpa: boolean };
  aiConsented: boolean;
  aiAvailable: boolean;
  exports: { id: string; exportedAt: string | null }[];
}) {
  const router = useRouter();
  const { gate, panel } = useAiConsentGate(aiConsented);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const template = templates.find((t) => t.id === fields.templateId) ?? templates[0]!;

  const patch = async (body: Record<string, unknown>) => {
    const res = await api("PATCH", "/api/documents/brag-sheet", body);
    if (!res.ok) {
      setError(res.data.error ?? "Couldn't save.");
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  };

  const exportPdf = async () => {
    setExporting(true);
    const res = await downloadPdf("/api/documents/brag-sheet/export", {}, "brag-sheet.pdf");
    setExporting(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  };

  const includedLine = [
    `${included.activities} activit${included.activities === 1 ? "y" : "ies"}`,
    included.hasGpa ? "your GPA" : null,
    included.courses ? `${included.courses} course${included.courses === 1 ? "" : "s"}` : null,
    included.testScores ? `${included.testScores} test score${included.testScores === 1 ? "" : "s"}` : null,
    included.targets ? `${included.targets} target school${included.targets === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      {panel}

      <Card title="Who it's for" subtitle="Sets which sections lead and which questions you're asked.">
        <div className="grid gap-2 sm:grid-cols-3">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => t.id !== template.id && patch({ templateId: t.id })}
              className={`rounded-lg border p-3 text-left text-sm ${
                t.id === template.id
                  ? "border-zinc-900 bg-zinc-50 dark:border-white dark:bg-white/10"
                  : "border-black/10 hover:border-black/25 dark:border-white/15"
              }`}
              aria-pressed={t.id === template.id}
            >
              <span className="font-medium">{t.name}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{t.description}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          From your profile: {includedLine}.{" "}
          <Link href="/profile" className="underline underline-offset-2">
            Update your profile
          </Link>{" "}
          to change these.
        </p>
      </Card>

      <Card
        title="In your own words"
        subtitle="Saved exactly as you type them. Nothing here is written for you; leave any question blank to leave it off."
      >
        <label className="mb-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={fields.grammarOptIn}
            disabled={!aiAvailable}
            onChange={(e) => patch({ grammarOptIn: e.target.checked })}
          />
          <span>
            Offer spelling and grammar fixes
            <span className="block text-xs text-zinc-500">
              Off by default. A fix only corrects spelling, grammar and punctuation. It&apos;s shown beside your
              text, and nothing changes unless you accept it.
              {!aiAvailable && " Not available here: AI isn't connected."}
            </span>
          </span>
        </label>

        <div className="space-y-5">
          {template.prompts.map((p) => (
            <Story
              key={p.id}
              promptId={p.id}
              question={p.question}
              hint={p.hint}
              story={fields.stories[p.id]}
              grammarOn={fields.grammarOptIn && aiAvailable}
              onSave={(text) => patch({ story: { promptId: p.id, text } })}
              onAccept={() => patch({ acceptGrammar: p.id })}
              onReject={() => patch({ rejectGrammar: p.id })}
              gate={gate}
              onError={setError}
            />
          ))}
        </div>
      </Card>

      <Card title="Export" subtitle="A PDF to send or print. Each export is saved as it was.">
        <button type="button" className={primary} disabled={exporting} onClick={exportPdf}>
          {exporting ? "Preparing…" : "Download brag sheet (PDF)"}
        </button>
        <ErrorNote message={error} />
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

function Story({
  promptId,
  question,
  hint,
  story,
  grammarOn,
  onSave,
  onAccept,
  onReject,
  gate,
  onError,
}: {
  promptId: string;
  question: string;
  hint?: string;
  story: BragSheetFields["stories"][string] | undefined;
  grammarOn: boolean;
  onSave: (text: string) => Promise<boolean>;
  onAccept: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
  gate: (go: () => void) => () => void;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const saved = story?.text ?? "";
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setText(saved);
  }
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setNote(null);
    const res = await api<{ unchanged?: boolean }>("POST", "/api/documents/brag-sheet/grammar", { promptId });
    setChecking(false);
    if (!res.ok) return onError(res.data.error ?? "Couldn't check that story.");
    onError(null);
    if (res.data.unchanged) setNote("No fixes needed.");
    router.refresh();
  };

  return (
    <div>
      <label htmlFor={`story-${promptId}`} className="block text-sm font-medium">
        {question}
      </label>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      <textarea
        id={`story-${promptId}`}
        className="mt-1 min-h-24 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900"
        value={text}
        maxLength={3000}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved && onSave(text)}
      />
      {grammarOn && saved.trim() && !story?.grammarSuggestion && (
        <div className="mt-1 flex items-center gap-2">
          <button type="button" className={btn} disabled={checking || text !== saved} onClick={gate(check)}>
            {checking ? "Checking…" : "Check spelling & grammar"}
          </button>
          {note && <span className="text-xs text-zinc-500">{note}</span>}
        </div>
      )}
      {story?.grammarSuggestion && (
        <div className="mt-2 rounded-md border border-sky-300/60 bg-sky-50 p-3 text-sm dark:border-sky-500/30 dark:bg-sky-950/30">
          <p className="text-xs font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">Suggested fixes</p>
          <p className="mt-1 whitespace-pre-wrap">{story.grammarSuggestion}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} onClick={onAccept}>
              Use this
            </button>
            <button type="button" className={btn} onClick={onReject}>
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
