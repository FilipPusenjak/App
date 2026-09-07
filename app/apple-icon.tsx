// The iOS home-screen icon, for a student who adds CourseChart to their phone.
//
// 180x180 is the size iOS asks for. It is NOT rounded here: the system applies
// its own corner mask, and a rounded square inside that mask leaves the page
// colour showing in the corners.
//
// Same mark as the tab icon, from the same file, so the two cannot drift.
import { ImageResponse } from "next/og";
import { ChartMark } from "@/lib/brand/mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    // 180/32: the mark is designed at the 32px canvas and scales from it.
    <ChartMark scale={size.width / 32} rounded={false} />,
    { ...size },
  );
}
