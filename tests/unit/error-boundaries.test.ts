// What a user sees when something breaks.
//
// Before these files existed, the answer was Next's default grey screen: no
// branding, no way back, and no indication of whether the grades somebody had
// just typed in had survived. The tests below are mostly about the two things
// that page has to get right — not frightening the user, and not telling an
// attacker anything.
//
// The `retry` assertion is the load-bearing one. This version of Next passes
// `retry` to an error boundary; older versions passed `reset`, and that is the
// name most examples still use. A boundary destructuring `reset` gets undefined,
// renders a button that throws on click, and does it only on the page nobody
// visits until something has already gone wrong.
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source with comments stripped — the same helper billing.test.ts uses, for the
 * mirror-image reason.
 *
 * There it stops prose ABOUT a rule from satisfying a test. Here it stops prose
 * about a rule from FAILING one: every file below explains in a comment what it
 * deliberately does not say ("saying you lack permission would confirm the
 * thing exists"), and a check against raw source reads that explanation as the
 * mistake it is warning about.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const error = code("app/error.tsx");
const globalError = code("app/global-error.tsx");
const notFound = code("app/not-found.tsx");
const globals = readFileSync("app/globals.css", "utf8");

describe("the boundaries exist at all", () => {
  it("covers a route segment, the root layout, and a missing page", () => {
    for (const file of ["app/error.tsx", "app/global-error.tsx", "app/not-found.tsx"]) {
      expect(existsSync(file), `${file} is missing`).toBe(true);
    }
  });

  it("makes the two error boundaries client components", () => {
    // Next refuses an error boundary that is not one, and the failure is at
    // build time — but only if somebody builds before shipping.
    for (const src of [error, globalError]) {
      expect(src.trimStart().startsWith('"use client"')).toBe(true);
    }
  });

  it("does not make not-found a client component", () => {
    // It needs no interactivity, and a client component here would ship JS to
    // render two links.
    expect(notFound).not.toContain('"use client"');
  });
});

describe("the retry prop is the one this Next actually passes", () => {
  it("takes retry, not reset", () => {
    for (const src of [error, globalError]) {
      expect(src).toMatch(/retry\s*:\s*\(\)\s*=>\s*void/);
      expect(src).toMatch(/onClick=\{\(\) => retry\(\)\}/);
    }
  });

  it("never destructures reset, which would be undefined", () => {
    for (const src of [error, globalError]) {
      expect(src).not.toMatch(/\breset\b\s*[,}:]/);
    }
  });
});

describe("what the error page tells the user", () => {
  it("says their data is safe, because it is", () => {
    // The only thing somebody actually fears at this moment. Every write in
    // this app commits in a server action or route handler before anything
    // renders, so a render that throws cannot be a half-finished write.
    expect(error).toMatch(/nothing you have saved is affected/i);
  });

  it("offers a way onward as well as a retry", () => {
    expect(error).toMatch(/href="\/start"/);
  });

  it("shows the digest and never the message", () => {
    // In production Next replaces a server error's message precisely so
    // internals do not reach the browser. The digest is the hash that matches
    // it to the server log, which is the useful half.
    expect(error).toMatch(/error\.digest/);
    expect(error).not.toMatch(/error\.message|\{error\.stack\}/);
  });

  it("logs the error rather than swallowing it", () => {
    expect(error).toMatch(/console\.error\(error\)/);
  });
});

describe("the not-found page does not undo a deliberate notFound()", () => {
  it("never says the visitor lacks permission", () => {
    // Several routes call notFound() for something that exists but is not this
    // account's to see — another student's evaluation, the operations page.
    // Saying "you do not have permission" would confirm the thing exists,
    // which is exactly what returning a 404 instead of a 403 avoids.
    expect(notFound).not.toMatch(
      /permission|not allowed|forbidden|access denied|do not have access/i,
    );
  });

  it("does not distinguish a typo from a probe", () => {
    expect(notFound).toMatch(/not here|out of date|typo/i);
  });

  it("sends people to /start, not straight to a student surface", () => {
    // /start decides where an account belongs, so a counselor landing here is
    // not dropped onto a dashboard they have no business on.
    expect(notFound).toMatch(/href="\/start"/);
    expect(notFound).not.toMatch(/href="\/dashboard"/);
  });
});

describe("global-error stands on its own", () => {
  it("renders its own html and body, because it replaces the layout", () => {
    expect(globalError).toMatch(/<html/);
    expect(globalError).toMatch(/<body/);
  });

  it("imports no stylesheet, which would not load anyway", () => {
    expect(globalError).not.toMatch(/globals\.css|import .*\.css/);
  });

  it("sets its title with React rather than a metadata export", () => {
    // metadata is unsupported in a client component, and this must be one.
    expect(globalError).toMatch(/<title>/);
    expect(globalError).not.toMatch(/export const metadata/);
  });

  it("keeps the same palette as the app it is standing in for", () => {
    // The colours are written out longhand here because no stylesheet reaches
    // this file. That is a copy, and copies drift — so it is checked against
    // the source rather than trusted.
    const tokens = ["--background", "--foreground"];
    const values = tokens.flatMap((token) =>
      [...globals.matchAll(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map(
        (m) => m[1]!.toLowerCase(),
      ),
    );
    expect(values.length).toBeGreaterThanOrEqual(4);
    for (const value of values) {
      expect(
        globalError.toLowerCase(),
        `${value} is in globals.css but not in global-error.tsx`,
      ).toContain(value);
    }
  });
});
