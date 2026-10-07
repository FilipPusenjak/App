import { describe, expect, it } from "vitest";
import { nativePlatformFromUserAgent } from "@/lib/native-app";

const IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

describe("telling the app from a browser", () => {
  it("is a browser without the marker, on any platform", () => {
    expect(nativePlatformFromUserAgent(IOS)).toBeNull();
    expect(nativePlatformFromUserAgent(ANDROID)).toBeNull();
    expect(nativePlatformFromUserAgent(null)).toBeNull();
  });

  it("names the platform when the marker is there", () => {
    expect(nativePlatformFromUserAgent(`${IOS} CourseChartApp`)).toBe("ios");
    expect(nativePlatformFromUserAgent(`${ANDROID} CourseChartApp`)).toBe("android");
  });

  it("treats an iPad in desktop mode as iOS", () => {
    // iPadOS reports itself as a Mac by default. Inside the app that is still
    // the App Store's rules, so it must not fall through to "browser".
    expect(nativePlatformFromUserAgent(`${IPAD_DESKTOP_MODE} CourseChartApp`)).toBe("ios");
  });

  it("matches the marker the native config appends", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync("mobile/capacitor.config.ts", "utf8");
    expect(config).toMatch(/appendUserAgent:\s*"CourseChartApp"/);
  });
});
