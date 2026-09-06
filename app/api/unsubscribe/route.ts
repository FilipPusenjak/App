// The machine-readable half of unsubscribing.
//
// This is the URL in the List-Unsubscribe header, and mail clients reach it in
// two different ways:
//
//   POST — one-click. Gmail and others POST here when the reader presses the
//   unsubscribe control in the client's own chrome, with no browser involved.
//   The reply body is never shown to anybody, so it is a bare 200.
//
//   GET — a client that follows the header URL like an ordinary link, or a
//   reader who pasted it. Redirects to the page, which explains what happened
//   in words.
//
// Both spend the same token and are idempotent, because prefetchers and
// scanners follow links in mail all the time and a second visit must not read
// as a failure. Deliberately unauthenticated: see app/unsubscribe/page.tsx.
import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/email/reminders-store";

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  await unsubscribeByToken(token);
  // 200 whatever the token turned out to be. The sender is a mail provider
  // acting on a reader's behalf, and telling it a token was unrecognised
  // achieves nothing except making the reader's client report a failure.
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  await unsubscribeByToken(token);
  return NextResponse.redirect(
    new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, url.origin),
  );
}
