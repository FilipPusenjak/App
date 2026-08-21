"use client";

import { useActionState } from "react";
import {
  clearInviteCodeAction,
  createInviteCodeAction,
  giveGuardianConsentAction,
  giveStudentConsentAction,
  revokeGrantAction,
  type AccessResult,
} from "@/app/actions/counselor-access";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * The three buttons on a grant, deliberately unequal in weight.
 *
 * Consent is a plain secondary button. Ending access is the visually loud one,
 * always present, and never behind a menu or a confirmation — a student who
 * wants to stop sharing should be able to do it in one press from the page that
 * told them sharing was happening.
 */
export function ConsentButton({
  linkId,
  who,
  label,
}: {
  linkId: string;
  who: "student" | "guardian";
  label: string;
}) {
  const action = who === "student" ? giveStudentConsentAction : giveGuardianConsentAction;
  const [state, formAction] = useActionState<AccessResult, FormData>(action, {});

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="linkId" value={linkId} />
      <SubmitButton variant="secondary" pendingText="Saving…">
        {label}
      </SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function RevokeButton({ linkId }: { linkId: string }) {
  const [state, formAction] = useActionState<AccessResult, FormData>(
    revokeGrantAction,
    {},
  );

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="linkId" value={linkId} />
      <SubmitButton variant="danger" pendingText="Ending…">
        End access
      </SubmitButton>
      <Message state={state} />
    </form>
  );
}

/**
 * Generate or cancel the code a counselor redeems.
 *
 * The invitation runs student → counselor rather than the other way round, so
 * this control lives here and there is no counterpart on the counselor's side
 * that takes an email address. A counselor who could type an address to invite
 * a student could also type one to find out whether it belongs to an account.
 */
export function InviteControls({
  profileId,
  liveCode,
  expiresAt,
}: {
  profileId: string;
  liveCode: string | null;
  expiresAt: Date | null;
}) {
  const [createState, create] = useActionState<AccessResult, FormData>(
    createInviteCodeAction,
    {},
  );
  const [clearState, clear] = useActionState<AccessResult, FormData>(
    clearInviteCodeAction,
    {},
  );

  return (
    <div className="space-y-3">
      {liveCode ? (
        <div className="space-y-2">
          <p className="font-mono text-lg tracking-widest">{liveCode}</p>
          <p className="text-xs text-zinc-500">
            {expiresAt
              ? `Works until ${expiresAt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}, and once only.`
              : "Works once."}{" "}
            Give it only to the counselor you mean it for — whoever redeems it is
            asking for access to this student.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={create}>
              <input type="hidden" name="profileId" value={profileId} />
              <SubmitButton variant="secondary" pendingText="Replacing…">
                Replace it
              </SubmitButton>
            </form>
            <form action={clear}>
              <input type="hidden" name="profileId" value={profileId} />
              <SubmitButton variant="secondary" pendingText="Cancelling…">
                Cancel it
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <form action={create} className="space-y-2">
          <input type="hidden" name="profileId" value={profileId} />
          <SubmitButton variant="secondary" pendingText="Generating…">
            Create an invite code
          </SubmitButton>
          <p className="text-xs text-zinc-500">
            Redeeming it counts as your agreement. A parent or guardian still has
            to agree separately before the counselor can see anything.
          </p>
        </form>
      )}
      <Message state={createState} />
      <Message state={clearState} />
    </div>
  );
}

function Message({ state }: { state: AccessResult }) {
  if (state.error) {
    return <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>;
  }
  if (state.message) {
    return <p className="text-xs text-zinc-500">{state.message}</p>;
  }
  return null;
}
