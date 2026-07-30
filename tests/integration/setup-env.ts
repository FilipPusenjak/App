// Runs before each integration test FILE, before any app module loads.
//
// Its one job: make sure the app's Prisma client can only ever see the test
// database. DATABASE_URL is overwritten with TEST_DATABASE_URL before
// lib/db.ts reads it — and when no test database is configured, with an
// address that cannot resolve to anything, so a stray query in a skipped
// suite fails instead of quietly touching real data via .env.
import "dotenv/config";
import { assertSafeTestDatabaseUrl } from "../support/test-db";

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl) {
  assertSafeTestDatabaseUrl(testUrl);
  process.env.DATABASE_URL = testUrl;
} else {
  process.env.DATABASE_URL =
    "postgresql://blocked:blocked@127.0.0.1:9/no_test_database_configured";
}
