import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Application Profile Evaluator",
  description:
    "Build your college & career application profile and get honest, calibrated AI feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
