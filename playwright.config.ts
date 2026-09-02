// End-to-end test configuration.
//
// Playwright boots the real app (`next dev`) against the TEST database and
// drives a real browser through the full student journey. Requirements:
//
//   - TEST_DATABASE_URL must point at a throwaway Postgres database whose
//     name contains "test" (see TESTING.md). It is wiped by tests.
//   - The server is started WITHOUT an Anthropic API key, so evaluations run
//     in sample mode — e2e verifies the pipeline, not model output.
//
// The server runs on port 3100 so a dev server on 3000 can stay up.
import { defineConfig } from "@playwright/test";

// "localhost", NOT 127.0.0.1: Next 16 treats a browser arriving via
// 127.0.0.1 as a cross-origin dev client, refuses its HMR websocket, and
// Turbopack then never finishes hydrating the page — every client-side
// button stays dead. (Diagnosed the hard way; see TESTING.md.)
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// E2E_TARGET=prod runs the journey against a real production build instead of
// the dev server — the pre-deploy check. `next dev` and `next start` are not
// the same app: the production build minifies, prerenders what it can, and
// swallows the error detail dev shows you. A green dev run is not evidence
// that what you are about to ship works.
//
// Requires `npm run build` to have been run first; this only starts the server.
const PROD = process.env.E2E_TARGET === "prod";

export default defineConfig({
  testDir: "tests/e2e",
  // One journey, executed in order — parallelism buys nothing here.
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // `next dev` compiles routes on first visit, so first paint of each page
  // can take several seconds — give assertions room. A production build serves
  // them immediately and needs no such allowance.
  expect: { timeout: PROD ? 10_000 : 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: {
      // Normally unset (Playwright uses its own browser). Set it to point at
      // an existing Chromium when the managed download isn't available.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  webServer: {
    command: PROD
      ? `npx next start --port ${PORT}`
      : `npx next dev --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // These OVERRIDE .env/.env.local (Next never overrides vars that are
      // already set), which is what pins the server to the test database and
      // to sample mode even on a machine with a real key configured.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      AUTH_SECRET: "e2e-only-secret-do-not-use-anywhere-real",
      ANTHROPIC_API_KEY: "",
      EVAL_COOLDOWN_SECONDS: "0",
    },
  },
});
