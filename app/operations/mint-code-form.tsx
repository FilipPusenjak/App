"use client";

import { useActionState, useState } from "react";
import { mintAccessCodeAction, type MintCodeResult } from "@/app/actions/access-codes";
import { RUN_KINDS, RUN_LABELS, type RunKind } from "@/lib/billing/quota";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Mint a code without a terminal or the production database string.
 *
 * The one field worth a second look is "days until it expires" — blank means
 * the code never expires, which is fine for a handful of testers but worth
 * noticing before minting fifty.
 */
export function MintCodeForm() {
  const [state, formAction] = useActionState<MintCodeResult, FormData>(
    mintAccessCodeAction,
    {},
  );
  const [kind, setKind] = useState<RunKind>("DEEP_REVIEW");

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Grants">
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RunKind)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          >
            {RUN_KINDS.map((k) => (
              <option key={k} value={k}>
                {RUN_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How many codes">
          <input
            name="count"
            type="number"
            min={1}
            max={50}
            defaultValue={1}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          />
        </Field>
        <Field label="Redeemable by how many accounts">
          <input
            name="uses"
            type="number"
            min={1}
            defaultValue={1}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          />
        </Field>
        <Field label="Runs granted per redemption">
          <input
            name="grants"
            type="number"
            min={1}
            defaultValue={1}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          />
        </Field>
        <Field label="Expires in (days, blank = never)">
          <input
            name="days"
            type="number"
            min={1}
            placeholder="never"
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          />
        </Field>
        <Field label="Note (why these exist)" className="sm:col-span-2 lg:col-span-3">
          <input
            name="note"
            type="text"
            placeholder="e.g. beta testers, September"
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
          />
        </Field>
      </div>

      <SubmitButton pendingText="Minting…">Generate</SubmitButton>

      {state.error && (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      )}
      {state.codes && state.codes.length > 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            {state.codes.length === 1
              ? "Code minted — hand it out once, it works anywhere:"
              : `${state.codes.length} codes minted:`}
          </p>
          <ul className="mt-2 space-y-1 font-mono text-sm">
            {state.codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-300/70">
            Redeemed at /settings/billing &rarr; &ldquo;Have a code?&rdquo; A
            code is only spent when the plan&rsquo;s own schedule would
            otherwise refuse a run, so handing one out early is safe.
          </p>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs font-medium text-zinc-500 ${className}`}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
