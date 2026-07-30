// Guard shared by the integration and e2e setups.
//
// These test layers WIPE DATA in the database they are pointed at. This app
// holds personal data about minors, so "someone pointed the tests at the real
// database" must be impossible to do by accident: the database's NAME has to
// say it is a test database, or the run refuses to start.
export function assertSafeTestDatabaseUrl(url: string): string {
  let dbName: string;
  try {
    dbName = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: ${url}`);
  }

  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests against database "${dbName}". ` +
        `Tests DELETE data, so TEST_DATABASE_URL must name a dedicated test ` +
        `database whose name contains "test" (e.g. "apptest") — never your ` +
        `development or production database.`,
    );
  }
  return url;
}
