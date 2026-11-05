# CourseChart — store listing

Everything to paste into App Store Connect and Play Console. Character limits
are each store's own; every field below fits inside them. Screenshots and
graphics are in `mobile/store/` (see the end of this file).

Claims here are checked against the app: if a feature changes, change this.
Keywords and descriptions deliberately avoid other companies' trademarks (test
and application-service names), which Apple rejects in keywords.

---

## Both stores

**App name** (30 max): `CourseChart`

**Category:** Education. Secondary (Apple): Productivity.

**Privacy policy URL:** https://www.coursechart.app/privacy

**Support URL / contact:** needs an address someone answers. Set
`PRIVACY_CONTACT` in Vercel and use the same address here.

---

## App Store (Apple)

**Subtitle** (30 max, 29 used):
```
Honest feedback on admissions
```

**Promotional text** (170 max, 149 used — can be changed without a new review):
```
See where you stand for the universities on your list — judged by each country's own admissions rubric, with the next steps that would actually help.
```

**Keywords** (100 max, comma-separated, no spaces — 97 used):
```
college,university,admissions,applications,gpa,grades,counselor,student,planner,activities,essays
```

**Description** (4,000 max):
```
CourseChart tells you where your university application really stands, and what to do about it.

Build a profile of your grades, test results and activities, add the universities you're aiming for, and run a Deep Review. You get an honest, calibrated read — not encouragement — on how your profile fits each school, written for the stage you're at.

WHAT YOU GET
• Two scores that answer different questions: how you compare with others in your year, and where you stand against applicants to your most selective targets.
• A fit score for every school on your list, measured against that course's own bar — so you can see which schools are reaches, which are matches, and whether you have a safety.
• Every activity judged twice: what it's worth to an application today, and what it could become if you keep at it.
• A prioritised list of next steps, with effort and impact rated honestly.
• Gaps sorted by timing — what to start now, what comes later, and what you shouldn't worry about yet.

JUDGED THE WAY EACH SYSTEM ACTUALLY ADMITS
US holistic review and UK course-specific admissions value different things. CourseChart scores each system separately instead of blending them, and tells you when an activity counts in one and not the other.

FOR EVERY YEAR OF SCHOOL
A Grade 9 student isn't missing research or leadership titles — those come later. Reviews judge you against what's actually reachable at your stage, and name the things you could start now that compound over time.

KEEP TRACK BETWEEN REVIEWS
• Fortnightly check-ins that notice what's changed since your last review.
• Commitments you choose to take on, with due dates, followed up by name.
• Project your plans: see what a course or activity you're considering would be worth before you commit to it.
• A progress chart that follows your scores across your whole time at school.

WORK WITH YOUR COUNSELOR OR TUTOR
Invite a counselor or test-prep tutor with a code. They see your profile only after both you and a parent or guardian agree, you choose how much they see, and you can read a log of every time they opened it. Either of you can end access at any time.

HONEST BY DESIGN
• CourseChart never estimates admission probabilities or acceptance rates, and lists the facts you should check with each university yourself.
• Your profile is sent to our AI provider only when an AI feature runs, and only after you've given permission in the app.
• Your data isn't sold or used to train AI models. Export it any time, and deleting your account deletes it.

FREE AND PLUS
The free plan includes your profile, targets, check-ins and progress chart. Plus is a monthly subscription that adds Deep Reviews and plan projections.

CourseChart is a planning tool, not an admissions service, and is not affiliated with any university or exam board. For students aged 13 and over.
```

**What's New** (first release):
```
The first release of CourseChart for iPhone and iPad.
```

**App Review notes** (App Review Information → Notes):
```
CourseChart is a university-admissions planning tool for students aged 13+.

Sign-in: use the reviewer account below. Its profile is already filled in and AI permission is already given, so Settings → Plan, Evaluations and Plans can all be exercised.

AI: reviews, check-ins and projections are written by Anthropic's API. Before the first one, the app shows a permission screen naming Anthropic and listing what is sent (guideline 5.1.2(i)). It can be withdrawn in Settings → Sharing with our AI provider. Every AI-written screen has a "Report this AI-generated content" link.

In-app purchase: "Plus" (auto-renewable, monthly) is bought on Settings → Plan, with Restore purchases on the same screen. No other purchase mechanism appears in the app.

Account deletion: Settings → Delete my account (guideline 5.1.1(v)).

Counselor and tutor accounts are separate account types for professionals; their plans are not sold in the app.
```
Fill in **Sign-in information** with the reviewer account's email and password
(see docs/app-store.md → reviewer login).

**Age rating questionnaire:** answer "None" to every content category (no
violence, sexual content, profanity, drugs, gambling, horror). "Unrestricted web
access": **No** — the app only opens coursechart.app, and other links leave the
app for the system browser. "User-generated content": the app has no public or
shared user content; students' profiles are private to them and the people they
invite. Then confirm the resulting rating covers ages 13+, and do **not** choose
the Kids category.

---

## Google Play

**App name** (30 max): `CourseChart`

**Short description** (80 max, 73 used):
```
Honest, calibrated feedback on where you stand for university admissions.
```

**Full description** (4,000 max): use the App Store description above
unchanged — it names no platform and fits the limit.

**Graphics:**
- App icon: `mobile/store/play-icon-512.png` (512×512)
- Feature graphic: `mobile/store/play-feature-graphic.png` (1024×500)
- Phone screenshots: `mobile/store/screenshots/android/` (1080×2160)

**Target audience and content** (Policy → App content):
- Target age groups: **13–15, 16–17, 18 and over.** Do not select any group
  under 13. Selecting 13–17 means Play's policies for teen audiences apply;
  nothing in the app conflicts with them (no ads, no public user content).
- Ads: **No ads.**
- App access: **Some functionality is restricted** → give the reviewer
  account's credentials.
- Content rating questionnaire: Reference / education app; answer No to every
  violence, sexual-content, language, controlled-substance and gambling
  question. Users don't interact with each other in public.
- Data safety: use the table in docs/app-store.md → Privacy declarations.
  Data is encrypted in transit; users can request deletion (in-app).
- AI-generated content: the in-app report link is the "Report this
  AI-generated content" control under every AI-written screen.

---

## Screenshot set

All taken from the app itself, signed in as a fictional demo student (Maya
Okonkwo, scripts/seed-demo.ts) with a real Deep Review written from her
profile. Regenerate with scripts/store-demo-review.ts, then
scripts/store-screenshots.mjs.

| # | Shows | Caption suggestion |
|---|---|---|
| 1 | Dashboard | Know where you stand |
| 2 | Review scores and summary | Two scores, two honest questions |
| 3 | Fit by target school | See which schools are reaches |
| 4 | Every activity judged | Every activity, judged twice |
| 5 | Prioritised next steps | What to do next, in order |
| 6 | Counselor's weekly view | Built for counselors too |

- iPhone 6.9" (1320×2868): `mobile/store/screenshots/iphone/`
- iPad 13" (2064×2752): `mobile/store/screenshots/ipad/` — required because
  the app runs on iPad
- Android phone (1080×2160): `mobile/store/screenshots/android/`

Apple accepts up to 10 per device size and Play up to 8; upload in the order
above.
