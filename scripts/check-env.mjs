// Fail the BUILD when required configuration is missing, rather than shipping
// a site that looks fine and is broken.
//
// This exists because of how AUTH_SECRET fails. Without it, `next build`
// succeeds, every page renders, /login returns 200 — and then logging in
// throws MissingSecret into a server log nobody is watching. The deploy is
// green, the URL loads, and the app is unusable. That is the worst shape a
// failure can take: it looks like success.
//
// A missing DATABASE_URL already fails loudly (migrate deploy stops the
// build), so this is mostly about the ones that do not.
//
// Set SKIP_ENV_VALIDATION=1 to bypass — used by the e2e build, which compiles
// the app before the test harness supplies its own throwaway values.

const REQUIRED = [
  {
    name: "DATABASE_URL",
    why: "PostgreSQL connection string. Without it the build cannot apply migrations.",
  },
  {
    name: "AUTH_SECRET",
    why: "Session signing secret. Without it the app builds and serves, but nobody can log in. Generate one with: openssl rand -base64 32",
  },
];

if (process.env.SKIP_ENV_VALIDATION === "1") {
  process.exit(0);
}

const missing = REQUIRED.filter(({ name }) => !process.env[name]?.trim());

if (missing.length > 0) {
  const lines = [
    "",
    "  Build stopped: required configuration is missing.",
    "",
    ...missing.flatMap(({ name, why }) => [`  ${name}`, `      ${why}`, ""]),
    "  Set these where the app is hosted (on Vercel: Settings → Environment",
    "  Variables), or in .env / .env.local locally. See DEPLOYMENT.md.",
    "",
  ];
  console.error(lines.join("\n"));
  process.exit(1);
}
