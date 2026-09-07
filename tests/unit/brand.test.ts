// The name and the mark.
//
// Both are the kind of thing that breaks silently. A generated icon is built by
// satori, which throws on CSS it does not implement rather than degrading, and
// nothing renders /icon during a normal test run — so a mark that has stopped
// building looks exactly like one that works until somebody opens a tab. And a
// rename is only done when the LAST copy of the old name is gone; the one left
// behind is always in the file nobody thought to grep.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BRAND = "CourseChart";

describe("the mark actually builds", () => {
  it("renders the tab icon to a PNG", async () => {
    // satori throws on unsupported CSS. This is the only thing that finds that
    // out before a browser does.
    const { default: Icon } = await import("@/app/icon");
    const response = Icon() as unknown as Response;
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(bytes.length).toBeGreaterThan(0);
    // PNG magic number, so a body that is an error page cannot pass.
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 30_000);

  it("renders the iOS home-screen icon from the same mark", async () => {
    const { default: AppleIcon } = await import("@/app/apple-icon");
    const response = AppleIcon() as unknown as Response;
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // Bigger canvas, so meaningfully more data than the 32px one. A mark that
    // silently rendered empty would still be a valid PNG.
    expect(bytes.length).toBeGreaterThan(1000);
  }, 30_000);

  it("is defined once and shared, so the two icons cannot drift", () => {
    for (const file of ["app/icon.tsx", "app/apple-icon.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain('from "@/lib/brand/mark"');
    }
  });

  it("leaves the iOS icon unrounded, because the system masks it", () => {
    // A rounded square inside Apple's own mask shows the page colour in the
    // corners.
    expect(readFileSync("app/apple-icon.tsx", "utf8")).toContain("rounded={false}");
  });

  it("draws from the navy the interface already uses", () => {
    // The mark is generated rather than exported from an image editor so this
    // stays true. zinc-900 in app/globals.css.
    const mark = readFileSync("lib/brand/mark.tsx", "utf8");
    expect(mark).toContain("#152a4d");
    expect(readFileSync("app/globals.css", "utf8")).toContain("#152a4d");
  });

  it("keys the SVG shapes instead of wrapping them in a fragment", () => {
    // Satori cannot stringify a React fragment inside <svg> — it throws
    // "Cannot convert a Symbol value to a string", which is a confusing way to
    // find out. The render tests above would catch it; this says why.
    const mark = readFileSync("lib/brand/mark.tsx", "utf8");
    expect(mark).not.toMatch(/<>\s*\n?\s*<(polygon|path|circle)/);
    for (const key of ["main", "jib", "hull"]) {
      expect(mark).toContain(`key="${key}"`);
    }
  });

  it("scales by the viewBox rather than by multiplying every coordinate", () => {
    // Two sizes are rendered from these numbers. Scaling by arithmetic on each
    // one is how the touch icon ends up subtly different from the tab icon.
    expect(readFileSync("lib/brand/mark.tsx", "utf8")).toContain("viewBox=");
  });
});

describe("no static favicon overrides the generated one", () => {
  it("app/favicon.ico is gone", () => {
    // Next emits a static favicon.ico as `sizes=\"any\"`, which browsers may
    // prefer over the generated icon. The scaffold's default was sitting there
    // outranking the real mark.
    expect(existsSync("app/favicon.ico")).toBe(false);
  });
});

describe("the rename left nothing behind", () => {
  const OLD_NAMES = ["Application Profile Evaluator", "Course Correction"];

  /** Every source and doc file, minus what is generated or vendored. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          ["node_modules", ".next", ".git", "generated", "test-results"].includes(
            entry.name,
          )
        ) {
          continue;
        }
        sourceFiles(path, out);
      } else if (/\.(ts|tsx|md|json|css)$/.test(entry.name)) {
        out.push(path);
      }
    }
    return out;
  }

  it("no file still carries an old name", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(".")) {
      const text = readFileSync(file, "utf8");
      for (const name of OLD_NAMES) {
        // This test names them itself, so it cannot be its own offender.
        if (file.endsWith("tests/unit/brand.test.ts")) continue;
        if (text.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the page title and the iOS label agree", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain(`title: "${BRAND}"`);
    expect(layout).toContain(`applicationName: "${BRAND}"`);
  });

  it("every surface a signed-out visitor sees carries the name", () => {
    for (const file of [
      "app/page.tsx",
      "app/(auth)/layout.tsx",
      "app/(app)/layout.tsx",
      "app/(app)/mobile-nav.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain(BRAND);
    }
  });
});
