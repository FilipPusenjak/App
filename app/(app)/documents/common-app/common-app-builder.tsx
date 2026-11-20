"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useAiConsentGate } from "@/components/ai-consent-panel";
import type { ActivityView, CommonAppView } from "@/lib/documents/view";
import {
  charCount,
  COMMON_APP_ACTIVITY_TYPES,
  GRADE_LEVELS,
  gradeLabel,
  gradesPhrase,
  RECOGNITION_LABELS,
  RECOGNITION_LEVELS,
  TIMING_LABELS,
  TIMINGS,
  type CommonAppLimits,
  type RecognitionLevel,
  type Timing,
} from "@/lib/documents/limits";
import { api, Card, CharCount, CopyButton, ErrorNote } from "../doc-ui";

type Props = {
  view: CommonAppView;
  aiConsented: boolean;
  aiAvailable: boolean;
  listRunsRemaining: number;
  exports: { id: string; exportedAt: string | null }[];
};

/** Local state that follows its prop whenever the prop itself changes. */
function useSynced<T>(value: T, same: (a: T, b: T) => boolean = Object.is) {
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (!same(seen, value)) {
    setSeen(value);
    setLocal(value);
  }
  return [local, setLocal] as const;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const grades = (levels: number[]) => levels.map(gradeLabel).join(", ");

const btn =
  "rounded-md border border-black/15 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const primary =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";
const input =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900";

export function CommonAppBuilder({ view, aiConsented, aiAvailable, listRunsRemaining, exports }: Props) {
  const router = useRouter();
  const { gate, panel } = useAiConsentGate(aiConsented);
  const [order, setOrder] = useSynced(view.order, sameList);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const dirty = !sameList(order, view.order);
  const max = view.limits.maxActivities;
  const notOnList = [
    ...view.notOnList.filter((id) => !order.includes(id)),
    // Removed locally but still on the saved list.
    ...view.order.filter((id) => !order.includes(id) && !view.notOnList.includes(id)),
  ];

  const move = (i: number, delta: number) => {
    const next = [...order];
    const [x] = next.splice(i, 1);
    next.splice(i + delta, 0, x!);
    setOrder(next);
  };

  const confirmOrder = async () => {
    setBusy("order");
    setError(null);
    const res = await api("PUT", "/api/documents/common-app/order", { order });
    setBusy(null);
    if (!res.ok) return setError(res.data.error ?? "Couldn't save the order.");
    setNotice("Order confirmed. It won't change unless you change it.");
    router.refresh();
  };

  const generate = (activityId?: string) => async () => {
    setBusy(activityId ? `gen:${activityId}` : "gen");
    setError(null);
    setNotice(null);
    const res = await api<{ written: string[]; skippedEdited: string[]; flagged: string[] }>(
      "POST",
      "/api/documents/common-app/generate",
      activityId ? { activityId } : {},
    );
    setBusy(null);
    if (!res.ok) return setError(res.data.error ?? "Couldn't write descriptions.");
    const { written = [], skippedEdited = [], flagged = [] } = res.data;
    const parts = [
      `${written.length - flagged.length} description${written.length - flagged.length === 1 ? "" : "s"} written`,
      skippedEdited.length ? `${skippedEdited.length} you edited left alone` : null,
      flagged.length ? `${flagged.length} need${flagged.length === 1 ? "s" : ""} your attention` : null,
    ].filter(Boolean);
    setNotice(parts.join(" · ") + ".");
    router.refresh();
  };

  const exportList = async () => {
    setBusy("export");
    setError(null);
    const res = await api<{ id: string }>("POST", "/api/documents/common-app/export");
    setBusy(null);
    if (!res.ok) {
      return setError(res.data.problems?.join(" ") ?? res.data.error ?? "Couldn't export.");
    }
    router.push(`/documents/exports/${res.data.id}`);
  };

  return (
    <div className="space-y-6">
      {panel}

      <Card
        title="Your list"
        subtitle={
          view.orderConfirmed && !dirty
            ? "Confirmed. This is your order, and it stays as you left it."
            : `A suggested order, from what's on your profile. Change anything, then confirm. Up to ${max} activities.`
        }
      >
        <ol className="space-y-2">
          {order.map((id, i) => {
            const a = view.activities[id]!;
            return (
              <li key={id} className="flex items-start gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
                <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-zinc-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  {a.reason && <p className="text-xs text-zinc-500">{a.reason}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${a.title} up`}>
                    ↑
                  </button>
                  <button type="button" className={btn} disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${a.title} down`}>
                    ↓
                  </button>
                  <button type="button" className={btn} onClick={() => setOrder(order.filter((x) => x !== id))} aria-label={`Remove ${a.title}`}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        {notOnList.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium">Not on the list</p>
            <ul className="mt-2 space-y-1">
              {notOnList.map((id) => {
                const a = view.activities[id]!;
                return (
                  <li key={id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      {a.title}
                      {a.reason && <span className="block text-xs text-zinc-500">{a.reason}</span>}
                    </span>
                    <button type="button" className={btn} disabled={order.length >= max} onClick={() => setOrder([...order, id])}>
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
            {order.length >= max && <p className="mt-1 text-xs text-zinc-500">The list is full. Remove one to add another.</p>}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={primary} disabled={busy !== null || (view.orderConfirmed && !dirty)} onClick={confirmOrder}>
            {busy === "order" ? "Saving…" : view.orderConfirmed && !dirty ? "Order confirmed" : "Confirm this order"}
          </button>
          {!sameList(order, view.suggestedOrder) && (
            <button type="button" className={btn} onClick={() => setOrder(view.suggestedOrder)}>
              Use the suggested order
            </button>
          )}
          {dirty && (
            <button type="button" className={btn} onClick={() => setOrder(view.order)}>
              Undo changes
            </button>
          )}
        </div>
      </Card>

      <Card
        title="Descriptions"
        subtitle={`Each one is shortened from your own words to ${view.limits.description} characters. Nothing is added: if a shortened version would add a number, name or claim you didn't make, it's flagged instead of used.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={primary}
            disabled={busy !== null || dirty || !aiAvailable || listRunsRemaining === 0 || order.length === 0}
            onClick={gate(generate())}
          >
            {busy === "gen" ? "Writing…" : "Write descriptions for the list"}
          </button>
          <span className="text-xs text-zinc-500">
            {!aiAvailable
              ? "AI isn't connected here. Every field can still be written by hand."
              : dirty
                ? "Confirm the list first."
                : `${listRunsRemaining} of 5 whole-list runs left this month. Fields you've edited are never rewritten.`}
          </span>
        </div>
        {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{notice}</p>}
        <ErrorNote message={error} />
      </Card>

      {order.map((id, i) => (
        <EntryCard
          key={id}
          index={i}
          a={view.activities[id]!}
          limits={view.limits}
          canGenerate={aiAvailable && !dirty && busy === null}
          generating={busy === `gen:${id}`}
          onGenerate={gate(generate(id))}
          onError={setError}
        />
      ))}

      <HonorsCard view={view} onError={setError} />

      <Card title="Export" subtitle="Saves this list exactly as it is now. Later changes to your profile won't alter an export.">
        <button type="button" className={primary} disabled={busy !== null || dirty} onClick={exportList}>
          {busy === "export" ? "Exporting…" : "Export the list"}
        </button>
        {!view.orderConfirmed && <p className="mt-2 text-xs text-zinc-500">Confirm your list and its order before exporting.</p>}
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

// ─── One activity ─────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; tone: string }> = {
  empty: { label: "Not written yet", tone: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300" },
  generated: { label: "Shortened from your words", tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" },
  edited: { label: "Your edit", tone: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" },
  flagged: { label: "Needs your attention", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
};

function EntryCard({
  a,
  index,
  limits,
  canGenerate,
  generating,
  onGenerate,
  onError,
}: {
  a: ActivityView;
  index: number;
  limits: CommonAppLimits;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [position, setPosition] = useSynced(a.entry.position);
  const [organization, setOrganization] = useSynced(a.entry.organization);
  const [description, setDescription] = useSynced(a.entry.description);
  const status = STATUS[a.entry.descriptionStatus] ?? STATUS.empty!;

  const save = (field: "position" | "organization" | "description", value: string, saved: string) => async () => {
    if (value === saved) return;
    const res = await api("PATCH", "/api/documents/common-app/field", { activityId: a.id, field, value });
    if (!res.ok) return onError(res.data.error ?? "Couldn't save that field.");
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          <span className="mr-2 tabular-nums text-zinc-400">{index + 1}</span>
          {a.title}
        </h3>
        <Link href={`/profile/items/${a.id}`} className="text-xs text-zinc-500 underline underline-offset-2">
          Edit on profile
        </Link>
      </div>

      {a.gaps.length > 0 && <GapQuestions a={a} onError={onError} />}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Detail label="Activity type" value={a.commonAppType} />
        <Detail label="Grades" value={a.gradeLevels.length ? grades(a.gradeLevels) : null} />
        <Detail label="Timing" value={a.timing ? TIMING_LABELS[a.timing as Timing] : null} />
        <Detail
          label="Hours"
          value={
            a.hoursPerWeek != null || a.weeksPerYear != null
              ? `${a.hoursPerWeek ?? "?"} hr/wk · ${a.weeksPerYear ?? "?"} wk/yr`
              : null
          }
        />
      </dl>

      <div className="mt-4 space-y-3">
        <Field label="Position / leadership" count={charCount(position)} limit={limits.position} copy={position}>
          <input
            className={input}
            value={position}
            placeholder="No position entered. Leave blank, or type the role you actually held."
            onChange={(e) => setPosition(e.target.value)}
            onBlur={save("position", position, a.entry.position)}
          />
        </Field>
        <Field label="Organization name" count={charCount(organization)} limit={limits.organization} copy={organization}>
          <input
            className={input}
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            onBlur={save("organization", organization, a.entry.organization)}
          />
        </Field>
        <Field
          label="Description"
          count={charCount(description)}
          limit={limits.description}
          copy={description}
          badge={<span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>{status.label}</span>}
        >
          <textarea
            className={`${input} min-h-20`}
            value={description}
            placeholder={a.describable ? "Not written yet." : "Add a fact below first. There's nothing to shorten yet."}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={save("description", description, a.entry.description)}
          />
        </Field>
        {a.entry.flag && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>{a.entry.flag.message}</p>
            {a.entry.flag.tokens && a.entry.flag.tokens.length > 0 && (
              <p className="mt-1">
                Not in what you wrote:{" "}
                {a.entry.flag.tokens.map((t) => (
                  <mark key={t} className="mr-1 rounded bg-amber-200 px-1 dark:bg-amber-800/60 dark:text-amber-50">
                    {t}
                  </mark>
                ))}
              </p>
            )}
            <p className="mt-1 text-xs">Edit it yourself, or add the missing fact to your profile and try again.</p>
          </div>
        )}
      </div>

      <Facts a={a} onError={onError} />

      <div className="mt-3 flex items-center gap-3">
        {a.edited.description ? (
          <p className="text-xs text-zinc-500">This description is your edit, so it won&apos;t be rewritten.</p>
        ) : (
          <button type="button" className={btn} disabled={!canGenerate || !a.describable} onClick={onGenerate}>
            {generating ? "Writing…" : a.entry.description ? "Rewrite this one" : "Write this one"}
          </button>
        )}
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={value ? "" : "text-zinc-400"}>{value ?? "—"}</dd>
    </div>
  );
}

function Field({
  label,
  count,
  limit,
  copy,
  badge,
  children,
}: {
  label: string;
  count: number;
  limit: number;
  copy: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </span>
        <span className="flex items-center gap-2">
          <CharCount count={count} limit={limit} />
          <CopyButton text={copy} />
        </span>
      </span>
      {children}
    </label>
  );
}

// ─── Facts and gap questions: answers go to the PROFILE ───────────────────────

function useActivityPatch(id: string, onError: (m: string | null) => void) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    const res = await api("PATCH", `/api/documents/activities/${id}`, body);
    setSaving(false);
    if (!res.ok) {
      onError(res.data.error ?? "Couldn't save that answer.");
      return false;
    }
    onError(null);
    router.refresh();
    return true;
  };
  return { patch, saving };
}

function Facts({ a, onError }: { a: ActivityView; onError: (m: string | null) => void }) {
  const { patch, saving } = useActivityPatch(a.id, onError);
  const [fact, setFact] = useState("");
  // The "no facts" gap question already offers this input.
  if (a.facts.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">Your facts</p>
      <p className="text-xs text-zinc-500">What descriptions are built from, along with your activity description. Saved to your profile.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {a.facts.map((f, i) => (
          <li key={i}>
            {f}{" "}
            <button
              type="button"
              className="text-xs text-zinc-500 underline"
              disabled={saving}
              onClick={() => patch({ facts: a.facts.filter((_, j) => j !== i) })}
            >
              remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (fact.trim() && (await patch({ addFact: fact }))) setFact("");
        }}
      >
        <input className={input} value={fact} onChange={(e) => setFact(e.target.value)} placeholder="Add another fact" maxLength={300} />
        <button type="submit" className={btn} disabled={saving || !fact.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function GapQuestions({ a, onError }: { a: ActivityView; onError: (m: string | null) => void }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-dashed border-amber-400/60 bg-amber-50/50 p-3 dark:border-amber-500/40 dark:bg-amber-950/20">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
        The Common App asks for these. Your answers are saved to your profile.
      </p>
      {a.gaps.map((g) => (
        <GapAnswer key={g.field} a={a} field={g.field} question={g.question} onError={onError} />
      ))}
    </div>
  );
}

function GapAnswer({
  a,
  field,
  question,
  onError,
}: {
  a: ActivityView;
  field: ActivityView["gaps"][number]["field"];
  question: string;
  onError: (m: string | null) => void;
}) {
  const { patch, saving } = useActivityPatch(a.id, onError);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  const submit = (body: Record<string, unknown>) => (e: React.FormEvent) => {
    e.preventDefault();
    void patch(body);
  };
  const save = (disabled: boolean) => (
    <button type="submit" className={btn} disabled={saving || disabled}>
      {saving ? "Saving…" : "Save"}
    </button>
  );

  let control: React.ReactNode;
  let body: Record<string, unknown> = {};
  let empty = !text.trim();
  if (field === "commonAppType") {
    body = { commonAppType: text };
    control = (
      <select className={input} value={text} onChange={(e) => setText(e.target.value)}>
        <option value="">Choose…</option>
        {COMMON_APP_ACTIVITY_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    );
  } else if (field === "timing") {
    body = { timing: text };
    control = (
      <select className={input} value={text} onChange={(e) => setText(e.target.value)}>
        <option value="">Choose…</option>
        {TIMINGS.map((t) => (
          <option key={t} value={t}>
            {TIMING_LABELS[t]}
          </option>
        ))}
      </select>
    );
  } else if (field === "gradeLevels") {
    body = { gradeLevels: picked };
    empty = picked.length === 0;
    control = (
      <div className="flex flex-wrap gap-3 text-sm">
        {GRADE_LEVELS.map((g) => (
          <label key={g} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={picked.includes(g)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, g] : picked.filter((x) => x !== g))}
            />
            {gradeLabel(g)}
          </label>
        ))}
      </div>
    );
  } else if (field === "hoursPerWeek" || field === "weeksPerYear") {
    const n = Number(text);
    const max = field === "hoursPerWeek" ? 168 : 52;
    empty = text.trim() === "" || !Number.isFinite(n) || n < 0 || n > max;
    body = { [field]: field === "weeksPerYear" ? Math.round(n) : n };
    control = (
      <input
        className={`${input} max-w-32`}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={field === "hoursPerWeek" ? 0.5 : 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  } else {
    body = { addFact: text };
    control = (
      <input className={input} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="In your own words" />
    );
  }

  return (
    <form onSubmit={submit(body)}>
      <p className="mb-1 text-sm">{question}</p>
      <div className="flex items-center gap-2">
        {control}
        {save(empty)}
      </div>
    </form>
  );
}

// ─── Honors: assembled by code, no model ──────────────────────────────────────

function HonorsCard({ view, onError }: { view: CommonAppView; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [level, setLevel] = useState<RecognitionLevel | "">("");
  const [saving, setSaving] = useState(false);
  const limit = view.limits.honorTitle;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await api("POST", "/api/documents/honors", { title, gradeLevels: picked, recognitionLevel: level });
    setSaving(false);
    if (!res.ok) return onError(res.data.error ?? "Couldn't add that honor.");
    setTitle("");
    setPicked([]);
    setLevel("");
    onError(null);
    router.refresh();
  };
  const remove = async (id: string) => {
    const res = await api("DELETE", `/api/documents/honors/${id}`);
    if (!res.ok) return onError(res.data.error ?? "Couldn't remove that honor.");
    router.refresh();
  };

  return (
    <Card
      id="honors"
      title="Honors"
      subtitle={
        <>
          Up to {view.limits.maxHonors}, each title up to {limit} characters. Listed highest recognition first.
          {!view.honorsLimitsConfirmed && (
            <span className="mt-1 block text-amber-700 dark:text-amber-400">
              These honors limits haven&apos;t been confirmed for {view.cycle} yet. Check them in the application itself.
            </span>
          )}
        </>
      }
    >
      {view.honors.length > 0 ? (
        <ol className="space-y-2">
          {view.honors.map((h, i) => (
            <li
              key={h.id}
              className={`rounded-lg border p-3 ${i >= view.limits.maxHonors ? "border-dashed border-black/15 opacity-60 dark:border-white/15" : "border-black/10 dark:border-white/10"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-medium">{h.title}</p>
                <span className="flex shrink-0 items-center gap-2">
                  <CharCount count={charCount(h.title)} limit={limit} />
                  <CopyButton text={h.title} />
                  <button type="button" className={btn} onClick={() => remove(h.id)}>
                    Remove
                  </button>
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {[RECOGNITION_LABELS[h.recognitionLevel], h.gradeLevels.length ? gradesPhrase(h.gradeLevels) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-zinc-500">No honors added yet.</p>
      )}
      {view.honors.length > view.limits.maxHonors && (
        <p className="mt-2 text-xs text-zinc-500">
          You have {view.honors.length}; the Common App takes {view.limits.maxHonors}. Remove the ones you&apos;d leave off.
        </p>
      )}

      {view.awards.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium">Awards on your profile</p>
          <ul className="mt-1 space-y-1 text-sm">
            {view.awards.map((aw) => (
              <li key={aw.id} className="flex items-center justify-between gap-2">
                <span>{aw.title}</span>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    setTitle(aw.title);
                    setPicked(aw.gradeLevels);
                  }}
                >
                  Use as honor
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={add} className="mt-4 space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
        <p className="text-sm font-medium">Add an honor</p>
        <div className="flex items-center gap-2">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, as the award was named" />
          <CharCount count={charCount(title)} limit={limit} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-500">Grades:</span>
          {GRADE_LEVELS.map((g) => (
            <label key={g} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={picked.includes(g)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, g] : picked.filter((x) => x !== g))}
              />
              {gradeLabel(g)}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${input} max-w-56`} value={level} onChange={(e) => setLevel(e.target.value as RecognitionLevel)}>
            <option value="">Level of recognition…</option>
            {RECOGNITION_LEVELS.map((r) => (
              <option key={r} value={r}>
                {RECOGNITION_LABELS[r]}
              </option>
            ))}
          </select>
          <button type="submit" className={btn} disabled={saving || !title.trim() || !level}>
            {saving ? "Adding…" : "Add honor"}
          </button>
        </div>
      </form>
    </Card>
  );
}
