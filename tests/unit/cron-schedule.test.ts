// What is actually scheduled, and what it is allowed to cost.
//
// Two cron entries is not a preference, it is the Hobby plan's cap. A third
// entry is not rejected by a linter or caught by a test run — it is rejected
// by VERCEL, at deploy time, which means the way you discover it is a failed
// production deployment. So the count is asserted here, where it is cheap.
//
// That cap is why the check-in nudge has no schedule of its own and rides
// along on the daily job instead. The risk of combining two jobs into one
// invocation is that either one's failure silences the other, so that is
// asserted too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REMIND_AFTER_DAYS, REMIND_COOLDOWN_DAYS } from "@/lib/email/reminders";

type CronEntry = { path: string; schedule: string };
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons: CronEntry[];
  regions: string[];
};

describe("vercel.json", () => {
  it("stays within the two cron jobs the plan allows", () => {
    expect(
      config.crons.length,
      "a third cron entry is refused by Vercel at DEPLOY time, so adding one " +
        "breaks production rather than failing a test — fold the work into " +
        "the daily job instead, or upgrade the plan first",
    ).toBeLessThanOrEqual(2);
  });

  it("schedules the daily job and the weekly sweep, and nothing else", () => {
    expect(config.crons.map((c) => c.path).sort()).toEqual([
      "/api/cron/daily",
      "/api/retention",
    ]);
  });

  it("points every entry at a route that exists", () => {
    // A path typo is a job that never runs, and a 404 to a scheduler is
    // silent — nothing in the app notices it was never called.
    for (const { path } of config.crons) {
      const file = `app${path}/route.ts`;
      expect(() => readFileSync(file, "utf8"), `${file} is missing`).not.toThrow();
    }
  });

  it("runs the daily job at an hour when a nudge is worth receiving", () => {
    // It carries the check-in reminder, so the hour is a product decision
    // rather than an arbitrary one: 16:00 UTC is around midday in the US,
    // where the students on this deployment are. The old 06:00 was 2am there.
    const daily = config.crons.find((c) => c.path === "/api/cron/daily")!;
    const hour = Number(daily.schedule.split(" ")[1]);
    expect(hour).toBeGreaterThanOrEqual(13);
    expect(hour).toBeLessThanOrEqual(20);
  });

  it("keeps the region pinned next to the database", () => {
    expect(config.regions).toEqual(["cle1"]);
  });
});

describe("the daily job", () => {
  const src = readFileSync("app/api/cron/daily/route.ts", "utf8");

  it("runs both the triage pass and the reminder pass", () => {
    expect(src).toContain("runTriage");
    expect(src).toContain("runReminderPass");
  });

  it("isolates each job from the other's failure", () => {
    // The whole risk of one invocation doing two things. A triage query that
    // throws must not mean nobody is reminded for a day, and a mail outage
    // must not stop caseloads being recomputed.
    const triageAt = src.indexOf('attempt("triage"');
    const remindersAt = src.indexOf('attempt("reminders"');
    expect(triageAt).toBeGreaterThan(-1);
    expect(remindersAt).toBeGreaterThan(-1);
    expect(src).toMatch(/try \{[\s\S]*?await job\(\)[\s\S]*?\} catch/);
  });

  it("reports what each job did rather than throwing", () => {
    // A 500 tells the scheduler nothing about which half worked.
    expect(src).toMatch(/triage: triage\.ok/);
    expect(src).toMatch(/reminders: reminders\.ok/);
  });

  it("is reachable only by the scheduler, and fails closed", () => {
    expect(src).toContain("CRON_SECRET");
    expect(src).toMatch(/secret && secret\.trim\(\)/);
  });

  it("has no signed-in fallback, because it sends mail to other people", () => {
    expect(src).not.toMatch(/getCurrentUser|requireUserId|getCounselorAccount/);
  });
});

describe("running the nudge daily does not mail anybody more often", () => {
  it("because the cooling-off window, not the schedule, is what bounds it", () => {
    // The rule that makes a daily schedule safe. If the cooldown were ever
    // shortened below the due threshold, a daily pass could mail somebody
    // repeatedly while they stayed quiet.
    expect(REMIND_COOLDOWN_DAYS).toBeGreaterThan(REMIND_AFTER_DAYS);
  });
});
