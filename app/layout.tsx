import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";

/**
 * Nunito Sans — a warmer face than the system stack it replaces.
 *
 * Humanist rather than geometric: open apertures, softly rounded terminals, a
 * tall x-height that holds up at the small sizes this interface uses a lot. It
 * reads as friendly without tipping into the rounded, childish end, which
 * matters for an app whose job is telling a teenager things they may not want
 * to hear.
 *
 * Loaded through next/font, so it is SELF-HOSTED at build time: no request to
 * Google at runtime, nothing leaking a reader's IP to a third party, and no
 * flash of unstyled text. The system stack remains the fallback.
 */
const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-custom",
  // Only the weights the interface actually uses: body, medium for labels and
  // buttons, semibold and bold for headings.
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CourseChart",
  // What iOS labels the icon when a student adds it to their home screen.
  // Without it the label is taken from the page title, which changes per page.
  applicationName: "CourseChart",
  description:
    "Build your college & career application profile and get honest, calibrated AI feedback.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled. Some people need it to read, and turning it off
  // is an accessibility failure rather than a polish detail.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${nunitoSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
