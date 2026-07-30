// Prepares the test database before the e2e server boots.
import "dotenv/config";
import { execSync } from "node:child_process";
import { assertSafeTestDatabaseUrl } from "../support/test-db";

export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. The e2e test boots the app against a " +
        'throwaway Postgres database, e.g. TEST_DATABASE_URL="postgresql://' +
        'postgres@127.0.0.1:5432/apptest". See TESTING.md.',
    );
  }
  assertSafeTestDatabaseUrl(url);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
