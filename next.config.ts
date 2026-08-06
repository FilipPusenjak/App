import type { NextConfig } from "next";

/* ---------------------------------------------------------------------------
   Security headers

   This app holds a minor's grades, test scores and resume — the kind of thing
   that is only ever meant to be seen by the person who entered it. Ownership
   checks in the data layer stop one account reading another's records; these
   headers cover the attacks that come at the BROWSER instead, and cost nothing.

   Deliberately NOT here: a script-src Content-Security-Policy. Next injects
   inline bootstrap scripts, so a real CSP needs per-request nonces threaded
   through the root layout, and a half-configured one either breaks the app or
   lulls you with a policy that allows 'unsafe-inline' anyway. frame-ancestors
   is the part that needs no nonce, so that part ships now.
--------------------------------------------------------------------------- */
const securityHeaders = [
  {
    // Clickjacking. Without it, any site can iframe this one invisibly and
    // trick a signed-in student into clicking "Delete my account" or a form
    // that rewrites their profile. frame-ancestors is the modern spelling;
    // X-Frame-Options is kept for older browsers that ignore it.
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  // Stop the browser second-guessing a Content-Type — an uploaded or exported
  // file that sniffs as HTML would otherwise run as HTML on our own origin.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never leak a full URL to a third party. Evaluation and projection URLs
  // carry record ids; the origin alone is all anyone off-site needs.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app asks for none of these, so refuse them outright rather than leave
  // the door open for anything embedded later.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Force HTTPS for a year. No `preload` — that submits the domain to a list
  // baked into browsers, which is painful to undo and is a decision to make
  // deliberately, not as a side effect of a first deploy. Browsers ignore this
  // over plain http, so local development is unaffected.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
