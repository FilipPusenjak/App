"use client";

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces the entire document rather than rendering inside it, which is
 * why it carries its own <html> and <body> — and why NONE of the app's styling
 * reaches it. globals.css is imported by the root layout, and the root layout is
 * the thing that just failed, so every colour and font here has to be written
 * out longhand. See node_modules/next/dist/docs, error.js → Global Error.
 *
 * It is deliberately plainer than app/error.tsx. That one can offer "try again"
 * meaningfully because only a route segment failed; by the time this renders,
 * the failure is in the shell every page shares, and a retry is far more likely
 * to reproduce it than to clear it. It still offers one — the cause can be
 * transient — but leads with a reload, which is what actually tends to work.
 *
 * The palette is copied from globals.css rather than imported, since a stylesheet
 * cannot be relied on here. If the app's colours change, these drift; that is
 * the accepted cost of a file whose entire job is working when nothing else is.
 * A test asserts the two agree.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#eef3f9",
          color: "#16202c",
        }}
      >
        {/* metadata exports are unavailable in a client component, so the tab
            title is set with React's own <title>. */}
        <title>Something went wrong — CourseChart</title>
        {/* The only way to reach prefers-color-scheme without a stylesheet. */}
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #0e161f !important; color: #e4ecf5 !important; }
            a.cc-btn { background: #e4ecf5 !important; color: #0e161f !important; }
          }
        `}</style>

        <div style={{ width: "100%", maxWidth: "32rem" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            CourseChart could not load
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              opacity: 0.75,
            }}
          >
            Nothing you have saved is affected. This is a problem loading the
            app itself, not a problem with your records.
          </p>

          <div
            style={{
              marginTop: "1.5rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            {/* A REAL <a>, not next/link, and the lint rule is wrong here.
                Link does a client-side navigation through the same router and
                root layout that just failed — it would re-enter the broken
                shell rather than leave it. A plain href forces a full document
                load, which is the only thing likely to actually recover. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              className="cc-btn"
              href="/"
              style={{
                borderRadius: "0.375rem",
                background: "#16202c",
                color: "#ffffff",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Reload
            </a>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                borderRadius: "0.375rem",
                border: "1px solid rgba(0,0,0,0.15)",
                background: "transparent",
                color: "inherit",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              Try again
            </button>
          </div>

          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                opacity: 0.55,
              }}
            >
              If you report this, quote reference{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </code>
              .
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
