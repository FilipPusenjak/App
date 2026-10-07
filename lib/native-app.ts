// Whether a request came from inside the CourseChart iOS or Android app.
//
// The native shells load this same site (mobile/capacitor.config.ts) and
// append "CourseChartApp" to the WebView's user agent. That marker is the only
// way the server can tell the app from a browser, and it is what lets the app
// leave out anything a store does not allow in an app — on iOS, chiefly a
// button that sells a subscription outside Apple's in-app purchase.
//
// NOT A SECURITY BOUNDARY. A user agent is whatever the client says it is, so
// this decides what to SHOW, never what anybody may DO. Hiding a checkout link
// from the app is fine; refusing a checkout because of this header is not.
import { headers } from "next/headers";

export const NATIVE_APP_MARKER = "CourseChartApp";

export type NativePlatform = "ios" | "android";

/** The platform of the native app making this request, or null for a browser. */
export function nativePlatformFromUserAgent(ua: string | null | undefined): NativePlatform | null {
  if (!ua || !ua.includes(NATIVE_APP_MARKER)) return null;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) return "ios";
  return null;
}

export async function nativePlatform(): Promise<NativePlatform | null> {
  return nativePlatformFromUserAgent((await headers()).get("user-agent"));
}
