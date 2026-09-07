// The browser-tab icon. A generated PNG rather than a static file, so the
// brand blue stays the single source of truth instead of a second, driftable
// copy baked into an image editor's export.
//
// The mark itself lives in lib/brand/mark.tsx, shared with the iOS home-screen
// icon — see there for why it is a sloop and why it was chosen at 16px.
import { ImageResponse } from "next/og";
import { CourseMark } from "@/lib/brand/mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<CourseMark size={size.width} />, { ...size });
}
