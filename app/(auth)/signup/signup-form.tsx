"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signupAction, type AuthFormState } from "@/app/actions/auth";
import { COUNTRIES } from "@/lib/data/countries";

const fieldClass =
  "mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-white/20 dark:bg-black/20 dark:focus:ring-white/10";

/**
 * One of the two account kinds, as a real radio inside a real label.
 *
 * Styled as a card but built on `<input type="radio">` rather than on two
 * buttons and a hidden field: arrow keys move between them, a screen reader
 * announces it as a choice with two options, and the value posts even if the
 * JavaScript that draws the selected state never runs.
 */
function KindOption({
  value,
  checked,
  onSelect,
  title,
  detail,
}: {
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-2 rounded-md border p-3 transition-colors ${
        checked
          ? "border-zinc-900 bg-zinc-50 dark:border-white dark:bg-white/10"
          : "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
      }`}
    >
      <input
        type="radio"
        name="accountKind"
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-zinc-500">{detail}</span>
      </span>
    </label>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signupAction,
    undefined,
  );
  // Kept in React state as well as posted, because the fields below it change.
  // Seeded from the last submission so a validation error does not silently
  // drop someone back onto the student form.
  const [kind, setKind] = useState<"STUDENT" | "COUNSELOR">(
    state?.values?.accountKind === "COUNSELOR" ? "COUNSELOR" : "STUDENT",
  );
  const counselor = kind === "COUNSELOR";

  return (
    <form action={action} className="space-y-4" noValidate>
      {/* Asked first, because it decides what the rest of the form is for.
          This is not a display preference — it decides whether the account gets
          a student profile or a caseload, and there is no way to switch later:
          a caseload holds other families' children, and an account that could
          promote itself into one would be an escalation path. */}
      <fieldset>
        <legend className="text-sm font-medium">What is this account for?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <KindOption
            value="STUDENT"
            checked={!counselor}
            onSelect={() => setKind("STUDENT")}
            title="A student"
            detail="You or your child. Private to you."
          />
          <KindOption
            value="COUNSELOR"
            checked={counselor}
            onSelect={() => setKind("COUNSELOR")}
            title="A counselor or tutor"
            detail="You run a caseload of students."
          />
        </div>
      </fieldset>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={state?.values?.name}
          className={fieldClass}
        />
        {state?.fieldErrors?.name && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.values?.email}
          className={fieldClass}
        />
        {state?.fieldErrors?.email && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={fieldClass}
        />
        {state?.fieldErrors?.password && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.password}
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-400">At least 8 characters.</p>
      </div>

      {/* The last field differs by account kind, because the two questions are
          about different things. A counselor's own country is not a fact about
          anyone's application, and a practice name is not a fact about a
          student's. */}
      {counselor ? (
        <div>
          <label htmlFor="orgName" className="text-sm font-medium">
            Your practice or organization
          </label>
          <input
            id="orgName"
            name="orgName"
            type="text"
            autoComplete="organization"
            defaultValue={state?.values?.orgName}
            className={fieldClass}
          />
          {state?.fieldErrors?.orgName && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {state.fieldErrors.orgName}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            Shown to students and families when they decide whether to give you
            access.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="countryOfOrigin" className="text-sm font-medium">
            Country of origin{" "}
            <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <select
            id="countryOfOrigin"
            name="countryOfOrigin"
            defaultValue=""
            className={fieldClass}
          >
            <option value="">Prefer not to say</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.countryOfOrigin && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {state.fieldErrors.countryOfOrigin}
            </p>
          )}
        </div>
      )}

      {counselor && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          You will see nothing about any student until they give you an invite
          code and both they and a parent or guardian agree. They can end that
          at any moment, without asking you.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {pending
          ? "Creating account…"
          : counselor
            ? "Create counselor account"
            : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Sign in
        </Link>
      </p>
    </form>
  );
}
