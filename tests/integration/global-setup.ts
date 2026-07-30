// Runs once before the integration project: applies migrations to the test
// database so the suite always tests against the schema as it will deploy.
//
// When TEST_DATABASE_URL is unset (e.g. a laptop without Postgres), this
// prints a notice and the tests skip themselves — `npm test` still passes.
import "dotenv/config";
import { execSync } from "node:child_process";
import { assertSafeTestDatabaseUrl } from "../support/test-db";

export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    console.log(
      "\n[integration] TEST_DATABASE_URL is not set — skipping integration tests." +
        "\n[integration] To run them, create a throwaway Postgres database and set e.g." +
        '\n[integration]   TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/apptest"' +
        "\n[integration] (see TESTING.md)\n",
    );
    return;
  }

  assertSafeTestDatabaseUrl(url);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
