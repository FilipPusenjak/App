// GET /api/course-options?name=...&country=GB — courses we hold data for.
//
// Feeds the course picker on the target form. Returns reference data only:
// course names at a university, shared by every student and identifying none.
// There is deliberately no ownership filter, because there is no owner.
//
// It still requires a signed-in user. The rows are not secret, but they are the
// output of real research on a private, invite-only instance, and an
// unauthenticated endpoint that enumerates them for any caller is a different
// thing from a feature for the people using the app.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { coursesForUniversity } from "@/lib/requirements/catalog";

const querySchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().length(2),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    name: url.searchParams.get("name") ?? "",
    country: url.searchParams.get("country") ?? "",
  });
  // A half-typed university name is the normal case, not an error — the field
  // is queried while someone types. Answer with an empty list rather than a 400
  // the form would have to special-case.
  if (!parsed.success) return NextResponse.json({ courses: [] });

  const courses = await coursesForUniversity(parsed.data.name, parsed.data.country);
  return NextResponse.json({ courses });
}
