# Publishing CourseChart to the App Store and Google Play

This is what is already done in code, what only the account owner can do,
and the open decision. Steps are in order.

## Already done in code

| Requirement | Where |
|---|---|
| Privacy policy URL (both stores) | `/privacy` → https://www.coursechart.app/privacy |
| Disclose third-party AI and ask first (Apple 5.1.2(i)) | `lib/ai-consent.ts`, `components/ai-consent-panel.tsx`; withdraw in Settings |
| In-app account deletion (Apple 5.1.1(v)) | Settings → Delete account (already existed) |
| Report AI-generated content in-app (Google Play AI policy) | `components/report-content.tsx`; queue on `/operations` |
| Native iOS and Android projects | `mobile/` (Capacitor 8); bundle ID `app.coursechart` |
| App icon, Android adaptive icon, splash (light and dark) | `scripts/render-app-icons.tsx`, then `cd mobile && npm run assets` |
| Offline screen instead of a blank WebView | `mobile/www/offline.html` |
| Encryption export compliance | `ITSAppUsesNonExemptEncryption = false` in `Info.plist` |
| Server can tell it is inside the app | `lib/native-app.ts` (user-agent marker `CourseChartApp`) |

Sign in with Apple is **not** required: Apple only requires it when an app
offers third-party sign-in, and CourseChart uses email and password only.

## How the app works, and the risk that comes with it

The app is a native shell that loads the live site (`server.url` in
`mobile/capacitor.config.ts`). The site is server-rendered, so it can't be
bundled into the app. Two things follow from that:

- **Every web deploy reaches app users immediately**, with no store review.
  Good for fixes. It also means a broken deploy breaks the app.
- **Apple guideline 4.2**: an app that only wraps a website can be rejected
  ("not sufficiently different from a mobile web browsing experience"). The
  in-app consent, reporting and deletion help, but they are web features. The
  most effective fix is a native feature Apple can see, and push notifications
  for check-in reminders are the obvious one, since the reminder emails already
  exist (`lib/email/reminders.ts`). That needs an APNs key (Apple) and a
  Firebase project (Android) from the owner. Plan to submit without it and add
  it if review rejects under 4.2, or build it first to lower the risk.

## Owner-only steps

### 1. Accounts
- **Apple Developer Program**: $99/year. Enrolling as an *organization* needs
  a D-U-N-S number and lists the company as the seller. Enrolling as an
  *individual* lists your own name.
- **Google Play Console**: $25 one-time. **New personal accounts must run a
  closed test with at least 12 testers for 14 days in a row** before they can
  publish to production. Start this early; it is the longest wait in the process.

### 2. Machines
- **iOS needs a Mac with Xcode** to build and upload. A cloud Mac build
  service (for example Codemagic or Ionic Appflow) can stand in for one.
- **Android** builds in Android Studio on any OS. Let Play App Signing manage
  the release key.

### 3. Production configuration (Vercel)
- Set **`PRIVACY_CONTACT`** to an address that will answer privacy requests.
  It isn't set today, so `/privacy` falls back to vague wording. Google Play
  requires a contact on the policy.
- Deploy this branch. The two new migrations (`aiConsentAt`, `ContentReport`)
  run in the build. **Every existing user, including the demo students, starts
  without AI consent** and will be asked on their next run. On the counselor
  demo, prep shows "This student hasn't allowed AI features" until each demo
  student's consent is set. `scripts/seed-demo.ts` sets it for newly seeded
  demo students; existing demo rows in production would need an update.

### 4. Build
```sh
cd mobile
npm install
npx cap sync
npm run ios       # opens Xcode: set your Team under Signing, then Product → Archive
npm run android   # opens Android Studio: Build → Generate Signed App Bundle
```
Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` (iOS) and `versionName` /
`versionCode` (Android) for each upload.

### 5. Store listings
Both stores need:
- **App name, subtitle/short description, full description**
- **Screenshots**: iPhone 6.9" (Apple's required size) and Android phone.
  Take them from the running app on a simulator or emulator.
- **Privacy policy URL**: https://www.coursechart.app/privacy
- **Support URL** (Apple requires one): a page or `mailto:` that someone answers
- **Age rating questionnaire**. The app is for ages 13 and up (`lib/validation/age.ts`).
  Don't put it in Apple's Kids category, and don't target under-13s on
  Google Play; either would bring in children's-app rules the app isn't built for.
- **A reviewer login.** Apple reviewers have to sign in. Create a student
  account with a filled-in profile and AI consent already given, and enter its
  credentials in App Review Information. Do the same in Play Console → App access.

### 6. Privacy declarations
Fill these in from `/privacy`. The stores' own wording decides which box each
item goes in, so check each one against the form:

| Data | Collected | Linked to user | Used for |
|---|---|---|---|
| Email address | yes | yes | account, password reset |
| Name (optional) | yes | yes | app functionality |
| Date of birth | yes | yes | age check |
| User content: profile, grades, activities, writing | yes | yes | app functionality (sent to Anthropic when the user allows it) |
| Purchase history (subscription status) | yes, if subscribed | yes | app functionality |
| User ID | yes | yes | app functionality |

Answers that are the same for every row: no tracking, no advertising, no data
sold, data encrypted in transit, users can request deletion (in-app).

## The open decision: payments

Paid plans are sold through Stripe (`/settings/billing`). The stores' rules on
that are:

- **Apple 3.1.1**: subscriptions that unlock features in the app must use
  in-app purchase. **United States storefront only:** apps may also include a
  button or link to buy on the web. **Apple 3.1.3(b)**: an app may let people
  use a subscription they bought elsewhere only if that subscription is also
  sold through in-app purchase.
- **Google Play**: digital subscriptions use Play Billing, with
  alternative/external billing programs available in some regions.

The options:

1. **Hide all purchasing inside the app** (using `lib/native-app.ts`). Free
   features work, and paid accounts keep what they paid for. This is the
   least work, but a paid feature that can't be bought in the app is
   exactly what 3.1.3(b) restricts, so it carries rejection risk.
2. **US-only external purchase link on iOS**, plus hiding purchasing
   elsewhere. This follows the current US rule, but ties iOS availability
   to the US storefront.
3. **Add in-app purchase on iOS and Play Billing on Android.** This is the
   fully compliant route and the most work: native purchase plugins,
   server-side receipt checks, and a way to reconcile them with the Stripe
   plans. Apple takes 15% (Small Business Program) to 30%.
