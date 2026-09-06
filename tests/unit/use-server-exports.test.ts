// A "use server" file may only export async functions.
//
// Next enforces this at RUNTIME, not at build time, so the failure mode is a
// 500 the first time somebody submits the form — not a compiler error, and
// not something any unit or integration test notices, because vitest imports
// the module happily and the constant is perfectly valid JavaScript.
//
// Found exactly that way: RESET_REQUESTED_MESSAGE was exported from
// app/actions/password-reset.ts, every test passed, and the forgot-password
// form 500'd on submit the first time it was opened in a browser. The constant
// now lives in lib/password-reset.ts, and this stops the next one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_DIR = join(process.cwd(), "app/actions");

const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));

describe("server action files", () => {
  it("has action files to check", () => {
    // Guards against the whole suite passing because the directory moved.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(ACTIONS_DIR, file), "utf8");
    if (!/^\s*["']use server["']/.test(source)) continue;

    it(`${file} exports only async functions`, () => {
      // `export const x = ...` where the value is not a function. Type-only
      // exports (`export type`) are erased before Next ever sees them, and
      // `export async function` is the shape this rule wants.
      const offenders: string[] = [];
      const pattern = /^export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(.*)$/gm;
      for (const match of source.matchAll(pattern)) {
        const [, name, value] = match;
        const isFunction =
          /^async\b/.test(value!) ||
          /^\(/.test(value!) ||
          /^function\b/.test(value!) ||
          /^\w+\s*=>/.test(value!);
        if (!isFunction) offenders.push(name!);
      }

      expect(
        offenders,
        `${file} exports ${offenders.join(", ")} from a "use server" file. ` +
          `Next allows only async functions there and rejects the rest at ` +
          `RUNTIME — a 500 on first submit, which no test will catch. Move ` +
          `constants and types to a plain module in lib/.`,
      ).toEqual([]);
    });
  }
});
