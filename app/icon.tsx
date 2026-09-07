// The browser-tab icon. A generated PNG rather than a static file, so the brand
// blue stays the single source of truth instead of a second, driftable copy
// baked into an image editor's export.
//
// SIXTY-FOUR, NOT THIRTY-TWO, and the number is not arbitrary. The mark is a
// sextant, chosen for character at the sizes people actually look at it — a
// bookmark bar, a history list, a phone home screen — and it carries detail
// that a 32px source throws away before the browser ever sees it. Rendering at
// 64 keeps that detail available.
//
// It has to be 64 rather than 48 or 50 because the browser does the resizing,
// not us: 64 halves to 32 and quarters to 16, so every step down lands on whole
// pixels and averages cleanly. A source that does not divide evenly into the
// size being displayed gets resampled across fractional pixels, which is the
// difference between a small sextant and a grey smudge.
//
// The mark itself lives in lib/brand/mark.tsx — see there for why it is a
// sextant, and what was rejected to get to it.
import { ImageResponse } from "next/og";
import { CourseMark } from "@/lib/brand/mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<CourseMark size={size.width} />, { ...size });
}
