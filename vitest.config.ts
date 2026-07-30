// Vitest configuration — two projects with very different requirements.
//
//   unit         tests/unit/**          No database, no network, no env setup.
//                                       Pure logic: schemas, rubrics, prompts.
//   integration  tests/integration/**   Runs against a REAL Postgres database
//                                       named by TEST_DATABASE_URL. Skipped
//                                       (loudly) when that variable is unset,
//                                       so `npm test` still works on a machine
//                                       without a local Postgres.
//
// The integration project points DATABASE_URL at TEST_DATABASE_URL before any
// app code loads (tests/integration/setup-env.ts), so the app's own Prisma
// client — the exact code that runs in production — is what gets tested,
// against a throwaway database. It must NEVER point at a real one; setup-env
// refuses URLs whose database name doesn't end in "test".
import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror tsconfig's `"@/*": ["./*"]`.
const alias = { "@": path.resolve(import.meta.dirname) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          // The test files share one database; running them in parallel would
          // let one file's cleanup delete another file's fixtures mid-test.
          fileParallelism: false,
          // Database round trips make these slower than unit tests.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
