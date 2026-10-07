// The native shells: an iOS and an Android app that open CourseChart.
//
// HOW IT LOADS. The web app is server-rendered on Vercel and cannot be
// exported to static files, so the shells load the live site rather than a
// bundled copy. That is `server.url`, which Capacitor documents as "not intended
// for use in production" — it is how its own live-reload works — and plenty of
// shipped apps use it anyway. The consequences are accepted on purpose:
//
//   - every deploy reaches app users immediately, with no store review;
//   - without a connection there is nothing to show, so `errorPath` shows a
//     local page that says so instead of a blank WebView;
//   - Apple's 4.2 rejects apps that are "a repackaged website", so the app has
//     to earn its place with native features — see docs/app-store.md.
//
// WWW, NOT THE BARE DOMAIN. coursechart.app 308-redirects to www, and a
// redirect on the very first request is a host the WebView then treats as
// external — the app would open Safari on launch.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS of the domain. PERMANENT: neither store lets an app change its
  // identifier after the first upload.
  appId: "app.coursechart",
  appName: "CourseChart",
  webDir: "www",
  // Lets the site tell it is inside the app (lib/native-app.ts) — which is how
  // it can hide anything the stores do not allow in an app, such as a Stripe
  // checkout button on iOS, without hiding it on the web.
  appendUserAgent: "CourseChartApp",
  backgroundColor: "#ffffff",
  server: {
    url: "https://www.coursechart.app",
    errorPath: "offline.html",
  },
  ios: {
    // Keeps content clear of the notch and home indicator for pages that do
    // not handle safe areas themselves.
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
  },
};

export default config;
