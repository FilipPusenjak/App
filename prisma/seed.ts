// Seed script — one fake student profile.
// Run with: npm run db:seed   (or: npx prisma db seed)
//
// The fake profile deliberately mixes US and UK targets so later milestones can
// demonstrate the two admissions rubrics side by side.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

const SEED_EMAIL = "student@example.com";
const SEED_PASSWORD = "password123";

/**
 * Refuse to seed anything that is not a local database.
 *
 * This file is in a public repository, so the credential above is public too.
 * Run against production it creates a working login that anyone who has read
 * this file can use — which is exactly what happened: the seed account sat in
 * the production user table for five weeks with its published password. It
 * held no real data, but it was a signed-in foothold on a site that holds
 * minors' records, and it got there by somebody running the normal seed
 * command with the wrong DATABASE_URL in their shell.
 *
 * "Local" means the host is loopback. That is deliberately narrower than "not
 * production": a staging database with real-looking data is not a place for a
 * known password either.
 */
function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable is not local. Fall through to the refusal.
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) {
    console.error(
      `\n  Refusing to seed: DATABASE_URL points at "${host || "an unparseable URL"}", not a local database.\n` +
        `  This seed creates the published login ${SEED_EMAIL} / ${SEED_PASSWORD}.\n` +
        `  It must never exist anywhere but a developer's own machine.\n`,
    );
    process.exit(1);
  }
}

async function main() {
  assertLocalDatabase();

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  // Idempotent: wipe any prior seed user; the cascade clears the profile and
  // all of its children (resume items, test scores, target schools).
  await prisma.user.deleteMany({ where: { email: SEED_EMAIL } });

  const user = await prisma.user.create({
    include: { profiles: true },
    data: {
      email: SEED_EMAIL,
      passwordHash,
      name: "Ada Sample",
      countryOfOrigin: "SG", // Singapore — an international applicant to US/UK
      profiles: {
        create: {
          studentName: "Ada Sample",
          countryOfOrigin: "SG",
          gradeLevel: "Grade 11",
          curriculum: "ib",
          gpa: 3.9,
          gpaScale: "4.0",
          intendedMajor: "Computer Science",
          careerGoal: "AI researcher",

          testScores: {
            create: [
              { kind: "sat", label: "SAT Total", score: "1500", maxScore: "1600" },
              { kind: "ib_total", label: "IB Predicted Total", score: "41", maxScore: "45", predicted: true },
              { kind: "predicted_grade", label: "Mathematics AA HL", score: "7", maxScore: "7", predicted: true },
              { kind: "predicted_grade", label: "Physics HL", score: "6", maxScore: "7", predicted: true },
              { kind: "predicted_grade", label: "Computer Science HL", score: "7", maxScore: "7", predicted: true },
              { kind: "ielts", label: "IELTS", score: "8.0", maxScore: "9.0" },
            ],
          },

          resumeItems: {
            create: [
              {
                type: "leadership",
                title: "Captain, Robotics Team",
                org: "Riverside High School",
                description:
                  "Led a 12-person FRC team; owned software subteam and competition strategy.",
                startDate: new Date("2024-09-01"),
                hoursPerWeek: 8,
                evidenceNotes: "Team advanced to regional finals 2025.",
              },
              {
                type: "research",
                title: "ML for early flood detection",
                org: "NUS High (mentorship)",
                description:
                  "Built a CNN on satellite imagery; wrote a short paper, not yet published.",
                startDate: new Date("2025-01-15"),
                endDate: new Date("2025-06-30"),
                hoursPerWeek: 6,
                evidenceNotes: "Mentor: Dr. Tan. Draft available; results modest.",
              },
              {
                type: "award",
                title: "National Olympiad in Informatics — Silver",
                org: "NOI",
                description: "Top ~10% nationally in competitive programming.",
                startDate: new Date("2025-03-01"),
              },
              {
                type: "project",
                title: "Open-source study-planner app",
                description:
                  "Next.js app with ~300 GitHub stars; used by classmates.",
                startDate: new Date("2024-06-01"),
                hoursPerWeek: 4,
                evidenceNotes: "Repo public; steady commit history.",
              },
              {
                type: "volunteering",
                title: "Coding tutor for younger students",
                org: "Community Centre",
                description: "Weekly beginner Python sessions for ages 11–14.",
                startDate: new Date("2024-02-01"),
                hoursPerWeek: 2,
              },
            ],
          },

          targetSchools: {
            create: [
              // US — holistic
              {
                name: "MIT",
                country: "US",
                course: "Computer Science and Engineering",
                classification: "reach",
                priority: 1,
              },
              {
                name: "University of Michigan",
                country: "US",
                course: "Computer Science",
                classification: "match",
                priority: 3,
              },
              // UK — course-specific depth
              {
                name: "University of Cambridge",
                country: "GB",
                course: "Computer Science (Tripos)",
                classification: "reach",
                priority: 2,
                notes: "Requires strong maths depth; check current admissions test.",
              },
              {
                name: "Imperial College London",
                country: "GB",
                course: "Computing (MEng)",
                classification: "match",
                priority: 4,
              },
            ],
          },
        },
      },
    },
  });

  console.log(
    `Seeded user "${user.email}" (profile id: ${user.profiles[0]?.id}).\n` +
      `  Login for later milestones -> ${SEED_EMAIL} / ${SEED_PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
