"use client";

import { useState } from "react";

/**
 * The two buttons that hand off to Stripe.
 *
 * Client components because they POST and then redirect the browser to a
 * Stripe-hosted page. They are deliberately the ONLY interactive part of the
 * billing screen — everything else renders on the server, so a page describing
 * what somebody is paying for does not depend on JavaScript having run.
 *
 * Both disable themselves while in flight. A double-click on a checkout button
 * otherwise opens two Checkout Sessions, and somebody who completes both has
 * two subscriptions and a support ticket.
 */

async function open(endpoint: string, body?: unknown): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => null)) as {
    url?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.url) {
    throw new Error(data?.error ?? "Could not reach the payment page.");
  }
  return data.url;
}

export function CheckoutButton({
  planCode,
  label,
}: {
  planCode: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            window.location.href = await open("/api/billing/checkout", {
              planCode,
            });
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy ? "Opening…" : label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            window.location.href = await open("/api/billing/portal");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
