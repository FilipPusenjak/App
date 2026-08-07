// Which build is this, actually? — SERVER ONLY.
//
// Added after a stretch of debugging where the only way to tell which commit a
// page came from was to compare its wording against the repository, and where
// "the deployment is X" and "the page is from X" turned out to be different
// claims. A production alias that has not moved, a preview URL open in another
// tab, or a cached page all produce a page from a build you are not looking at
// in the dashboard — and every conclusion drawn from that page is then about
// the wrong build.
//
// So the page says so itself. None of this is sensitive: a commit SHA of a
// repository, and which environment the deployment belongs to. No secrets, no
// connection strings, no key material.
//
// The environment is the one that matters most in practice. Environment
// variables are scoped per environment on most hosts, so "I set it for
// Production" and "I am looking at a Preview URL" is a silent mismatch that
// looks exactly like a variable that will not stick.

export type DeploymentInfo = {
  /** Short commit SHA, or null when not deployed on a host that reports one. */
  commit: string | null;
  /** "production" | "preview" | "development", or null when unknown. */
  environment: string | null;
  /** Branch the build came from, when the host reports it. */
  branch: string | null;
};

export function getDeploymentInfo(): DeploymentInfo {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    null;

  return {
    // Short form: enough to identify a build, and what the dashboard shows.
    commit: sha ? sha.slice(0, 7) : null,
    environment: process.env.VERCEL_ENV?.trim() || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF?.trim() || null,
  };
}
