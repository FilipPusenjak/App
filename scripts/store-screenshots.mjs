// App Store and Google Play screenshots, taken from the running app.
//
//   node scripts/store-screenshots.mjs [baseUrl] [outDir]
//
// Defaults to a local server (npx next start -p 3100) seeded with the demo
// accounts from scripts/seed-demo.ts, and writes to mobile/store/screenshots.
// NEVER point it at production: it signs in as demo accounts and its pictures
// end up in a public store listing, so it must only ever see fictional people.
//
// The user agent carries the native app's marker (see lib/native-app.ts), so
// these show exactly what the app shows — store purchase instead of Stripe, no
// code box — rather than the website.
//
// SIZES are the ones the stores ask for: iPhone 6.9" (1320x2868), iPad 13"
// (2064x2752; required because the iOS project supports iPad), and an Android
// phone at 1080x2160, since Play rejects screenshots whose long side is more
// than twice the short one.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "mobile/store/screenshots";
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  throw new Error("Screenshots are taken from a local demo server only — see the header.");
}

const PASSWORD = "demo-caseload-2026";
const STUDENT = "okonkwo@coursechart-demo.invalid";
const COUNSELOR = "advisor@coursechart-demo.invalid";

const DEVICES = {
  iphone: {
    viewport: { width: 440, height: 956 },
    scale: 3,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CourseChartApp",
  },
  ipad: {
    viewport: { width: 1032, height: 1376 },
    scale: 2,
    ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CourseChartApp",
  },
  android: {
    viewport: { width: 432, height: 864 },
    scale: 2.5,
    ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 CourseChartApp",
  },
};

/** Each frame: who is signed in, where, and which heading to scroll to. */
const FRAMES = [
  { name: "1-dashboard", as: STUDENT, path: "/dashboard" },
  { name: "2-review-scores", as: STUDENT, path: "LATEST_REVIEW", scrollTo: "text=/vs applicants/i", offset: -110 },
  { name: "3-school-fit", as: STUDENT, path: "LATEST_REVIEW", scrollTo: "h2:has-text('Fit by target school')" },
  { name: "4-every-item", as: STUDENT, path: "LATEST_REVIEW", scrollTo: "h2:has-text('Every resume item, judged')" },
  { name: "5-next-steps", as: STUDENT, path: "LATEST_REVIEW", scrollTo: "h2:has-text('Do these next')" },
  { name: "6-counselor", as: COUNSELOR, path: "/caseload" },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});

async function signIn(device, email) {
  const ctx = await browser.newContext({
    userAgent: device.ua,
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  return { ctx, page };
}

for (const [deviceName, device] of Object.entries(DEVICES)) {
  mkdirSync(`${OUT}/${deviceName}`, { recursive: true });
  const sessions = {};
  let latestReview = null;
  for (const frame of FRAMES) {
    sessions[frame.as] ??= await signIn(device, frame.as);
    const { page } = sessions[frame.as];
    if (frame.path === "LATEST_REVIEW" && !latestReview) {
      await page.goto(`${BASE}/evaluations`);
      latestReview = await page.$eval('a[href^="/evaluations/"]', (a) => a.getAttribute("href"));
    }
    await page.goto(BASE + (frame.path === "LATEST_REVIEW" ? latestReview : frame.path));
    await page.waitForLoadState("networkidle");
    if (frame.scrollTo) {
      const top = await page
        .locator(frame.scrollTo)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top + (frame.offset ?? -24)));
      await page.waitForTimeout(300);
    }
    // The demo accounts live on a reserved ".invalid" domain so they can never
    // be mailed. Correct for the database, odd in a store listing, so the
    // address shown in the iPad header is swapped for another fictional one
    // in the picture only.
    await page.evaluate((demoEmail) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue?.includes(demoEmail)) {
          n.nodeValue = n.nodeValue.replace(demoEmail, "maya@example.com");
        }
      }
    }, STUDENT);
    const file = `${OUT}/${deviceName}/${frame.name}.png`;
    await page.screenshot({ path: file });
    console.log(`wrote ${file}`);
  }
  for (const s of Object.values(sessions)) await s.ctx.close();
}

await browser.close();
