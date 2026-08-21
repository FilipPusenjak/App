"use client";

import { useActionState } from "react";
import {
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
