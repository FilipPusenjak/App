// Print the (university, course) pairs students have ACTUALLY targeted.
//
//   DATABASE_URL="<production>" npx tsx scripts/target-pairs.ts
//
// This is the seed list for the research brief. The brief is demand-driven on
// purpose: there are tens of thousands of course/university pairs in the world,
// requirements are republished annually, and a record nobody targets is effort
// spent on data that will go stale before it is ever read.
//
// So the list comes from the database rather than from anyone's idea of which
// courses are popular. "The 20 most commonly targeted courses" is not a
// published fact — inventing that list is the same guessing the brief spends
// two pages forbidding.
//
// OPERATOR SCRIPT. It aggregates across all accounts, which is why it is a CLI
// tool run with an explicit DATABASE_URL and not a route. It prints university
// and course names and a count. It never prints, joins to, or returns anything
// identifying a student — the output is a list of places, not of people.
import { prisma } from "../lib/db";

const args = process.argv.slice(2);
const withCourseOnly = !args.includes("--include-missing-course");

async function main() {
  const targets = await prisma.targetSchool.findMany({
    select: { name: true, country: true, course: true },
  });

  const counts = new Map<
    string,
    { name: string; country: string; course: string; n: number }
  >();
  let missingCourse = 0;

  for (const t of targets) {
    if (!t.course?.trim()) {
      missingCourse += 1;
      if (withCourseOnly) continue;
    }
    const course = t.course?.trim() || "(no course specified)";
    const key = `${t.country}::${t.name.toLowerCase()}::${course.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) existing.n += 1;
    else counts.set(key, { name: t.name, country: t.country, course, n: 1 });
  }

  const rows = [...counts.values()].sort(
    (a, b) => b.n - a.n || a.name.localeCompare(b.name),
  );

  console.error(
    `\n# ${rows.length} distinct pair(s) from ${targets.length} target(s).`,
  );
  if (missingCourse > 0) {
    console.error(
      `# ${missingCourse} target(s) have no course and are excluded — course-specific\n` +
        `# requirements cannot be looked up without one. Re-run with\n` +
        `# --include-missing-course to see them.`,
    );
  }
  console.error(`# Paste the lines below after the research brief.\n`);

  // Data on stdout, commentary on stderr, so `> list.txt` yields a clean file.
  for (const r of rows) console.log(`${r.name} | ${r.course}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
