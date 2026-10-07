"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

/**
 * Buying Student Plus inside the iOS or Android app.
 *
 * The purchase sheet is the store's own (StoreKit / Play Billing, through
 * @capgo/native-purchases). What happens after it is ours: the receipt goes to
 * the server, which verifies it with the store and writes the subscription —
 * see app/api/billing/iap. Nothing here decides that somebody has paid.
 *
 * The plugin is imported on demand so the web never loads it; this component
 * only renders inside the app.
 */

type Platform = "ios" | "android";

export type StoreProductConfig = {
  appleProductId: string;
  googleProductId: string;
  googleBasePlanId: string;
};

async function plugin() {
  const mod = await import("@capgo/native-purchases");
  return { NativePurchases: mod.NativePurchases, PURCHASE_TYPE: mod.PURCHASE_TYPE };
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => null)) as { error?: string; token?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong. Try again.");
  return data;
}

/** Hand a completed store transaction to the server to verify and record. */
async function report(
  platform: Platform,
  tx: { jwsRepresentation?: string; purchaseToken?: string },
) {
  if (platform === "ios") {
    if (!tx.jwsRepresentation) throw new Error("The App Store did not return a receipt.");
    await post("/api/billing/iap/apple", { signedTransaction: tx.jwsRepresentation });
  } else {
    if (!tx.purchaseToken) throw new Error("Google Play did not return a receipt.");
    await post("/api/billing/iap/google", { purchaseToken: tx.purchaseToken });
  }
}

export function StorePurchase({
  platform,
  products,
  current,
}: {
  platform: Platform;
  products: StoreProductConfig;
  /** True when this account already holds Plus from this store. */
  current: boolean;
}) {
  const router = useRouter();
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "buy" | "restore" | "manage">(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const productId = platform === "ios" ? products.appleProductId : products.googleProductId;
  const storeName = platform === "ios" ? "App Store" : "Google Play";

  // The price comes from the store, in the buyer's own currency. Apple
  // rejects apps that show a price other than the one the sheet will charge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { NativePurchases, PURCHASE_TYPE } = await plugin();
        const { products: found } = await NativePurchases.getProducts({
          productIdentifiers: [productId],
          productType: PURCHASE_TYPE.SUBS,
        });
        if (!cancelled && found[0]) setPrice(found[0].priceString);
      } catch {
        // No price means the store is unreachable; the button says so on press.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function buy() {
    setBusy("buy");
    setMessage(null);
    try {
      const { NativePurchases, PURCHASE_TYPE } = await plugin();
      const { token } = (await post("/api/billing/iap/token")) as { token: string };
      const tx = await NativePurchases.purchaseProduct({
        productIdentifier: productId,
        productType: PURCHASE_TYPE.SUBS,
        planIdentifier: platform === "android" ? products.googleBasePlanId : undefined,
        appAccountToken: token,
      });
      await report(platform, tx);
      setMessage({ kind: "ok", text: "You're on Plus." });
      router.refresh();
    } catch (e) {
      const text = (e as Error).message ?? "";
      // Closing the sheet is a choice, not an error.
      if (!/cancel/i.test(text)) setMessage({ kind: "error", text });
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    setMessage(null);
    try {
      const { NativePurchases, PURCHASE_TYPE } = await plugin();
      await NativePurchases.restorePurchases();
      const { purchases } = await NativePurchases.getPurchases({
        productType: PURCHASE_TYPE.SUBS,
        onlyCurrentEntitlements: true,
      });
      const ours = purchases.filter((p) => p.productIdentifier === productId);
      let restored = 0;
      let foreign = 0;
      for (const p of ours) {
        try {
          await report(platform, p);
          restored += 1;
        } catch {
          // Most often bought under another CourseChart account on this phone;
          // the server refuses those, and that is the right answer.
          foreign += 1;
        }
      }
      setMessage(
        restored > 0
          ? { kind: "ok", text: "Purchase restored." }
          : foreign > 0
            ? {
                kind: "error",
                text: "The purchase on this device belongs to a different CourseChart account.",
              }
            : { kind: "error", text: `No CourseChart purchase found on this ${storeName} account.` },
      );
      if (restored > 0) router.refresh();
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function manage() {
    setBusy("manage");
    try {
      const { NativePurchases } = await plugin();
      await NativePurchases.manageSubscriptions();
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const button =
    "rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";

  return (
    <div className="space-y-3">
      {current ? (
        <button
          type="button"
          onClick={manage}
          disabled={busy !== null}
          className={`${button} border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10`}
        >
          {busy === "manage" ? <Spinner /> : `Manage in ${storeName}`}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={buy}
            disabled={busy !== null}
            className={`${button} bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200`}
          >
            {busy === "buy" ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner /> Waiting for {storeName}…
              </span>
            ) : price ? (
              `Subscribe — ${price}/month`
            ) : (
              "Subscribe to Plus"
            )}
          </button>
          {/* The disclosure Apple requires beside an auto-renewing subscription:
              what it is, how long, what it costs, that it renews, how to stop
              it, and links to the terms and privacy policy. */}
          <p className="text-xs text-zinc-500">
            Plus is a monthly subscription{price ? ` at ${price} a month` : ""}, billed
            to your {storeName} account. It renews automatically unless you cancel it
            in your {storeName} settings at least 24 hours before the end of the
            current period.{" "}
            <Link href="/terms" className="underline underline-offset-2">
              Terms of Use
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>
          </p>
        </>
      )}
      <button
        type="button"
        onClick={restore}
        disabled={busy !== null}
        className="block text-xs text-zinc-500 underline underline-offset-2 hover:text-foreground disabled:opacity-60"
      >
        {busy === "restore" ? "Restoring…" : "Restore purchases"}
      </button>
      {message && (
        <p
          className={`text-sm ${message.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
