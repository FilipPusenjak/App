"use client";

// Small pieces shared by the document builder's pages.
import { useState } from "react";

export function Card({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <div className="mt-0.5 text-sm text-zinc-500">{subtitle}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Copies exactly the text shown — what gets pasted is what was checked. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (an insecure context, or permission denied):
          // the text is still on screen to select by hand.
        }
      }}
      className="shrink-0 rounded-md border border-black/15 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Live count against the limit. Counted the way the limit is: characters. */
export function CharCount({ count, limit }: { count: number; limit: number }) {
  const over = count > limit;
  return (
    <span
      className={`text-xs tabular-nums ${over ? "font-semibold text-rose-600 dark:text-rose-400" : "text-zinc-500"}`}
      aria-live="polite"
    >
      {count}/{limit}
      {over && ` — ${count - limit} over`}
    </span>
  );
}

export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: T & { error?: string; problems?: string[] };
};

export async function api<T = Record<string, unknown>>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the server. Check your connection and try again." } as T & { error: string } };
  }
}

/** Save a PDF response as a download. Returns the response for its headers. */
export async function downloadPdf(
  url: string,
  body: unknown,
  filename: string,
): Promise<{ ok: true; headers: Headers } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string }).error ?? "The export failed. Try again." };
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return { ok: true, headers: res.headers };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
      {message}
    </p>
  );
}
