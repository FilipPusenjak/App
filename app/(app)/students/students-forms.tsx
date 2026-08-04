"use client";

import { useActionState } from "react";
import {
  addStudentAction,
  deleteStudentAction,
  renameStudentAction,
  type StudentResult,
} from "@/app/actions/students";
import { SubmitButton } from "@/components/ui/submit-button";

const EMPTY: StudentResult = {};

function Message({ state }: { state: StudentResult }) {
  if (state.error) {
    return (
      <p className="mt-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="mt-2 text-sm text-green-700 dark:text-green-400">
        {state.message}
      </p>
    );
  }
  return null;
}

export function AddStudentForm() {
  const [state, action] = useActionState(addStudentAction, EMPTY);
  return (
    <form action={action}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="studentName" className="text-sm font-medium">
            Student name
          </label>
          <input
            id="studentName"
            name="studentName"
            required
            maxLength={120}
            placeholder="e.g. Priya Raman"
            className="mt-1 w-full rounded-md border border-black/15 bg-surface px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <SubmitButton>Add student</SubmitButton>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Adds an empty profile and switches to it. Each student keeps their own
        profile, targets, plans and evaluation history.
      </p>
      <Message state={state} />
    </form>
  );
}

export function RenameStudentForm({
  profileId,
  currentName,
}: {
  profileId: string;
  currentName: string;
}) {
  const [state, action] = useActionState(renameStudentAction, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="profileId" value={profileId} />
      <label htmlFor={`rename-${profileId}`} className="sr-only">
        New name
      </label>
      <input
        id={`rename-${profileId}`}
        name="studentName"
        defaultValue={currentName}
        required
        maxLength={120}
        className="min-w-0 flex-1 rounded-md border border-black/15 bg-surface px-2 py-1 text-sm dark:border-white/20"
      />
      <SubmitButton variant="secondary">Rename</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function DeleteStudentForm({
  profileId,
  name,
  canDelete,
}: {
  profileId: string;
  name: string;
  canDelete: boolean;
}) {
  const [state, action] = useActionState(deleteStudentAction, EMPTY);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Irreversible and cascading, so the warning names the student and
        // says exactly what goes with them.
        if (
          !confirm(
            `Delete ${name}? This permanently removes their profile, targets, plans and every evaluation. This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="profileId" value={profileId} />
      <button
        type="submit"
        disabled={!canDelete}
        title={
          canDelete
            ? undefined
            : "The only student on the account. Add another first."
        }
        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
      >
        Delete
      </button>
      <Message state={state} />
    </form>
  );
}
