// POST /api/developments — record something the student says happened.
//
// No id of any kind is accepted for the profile: it is resolved from the
// session inside lib/developments. The only client-supplied id is an optional
// commitmentId, which is checked against this profile before it is stored.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { addDevelopment } from "@/lib/developments";
import { developmentInputSchema } from "@/lib/validation/developments";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = developmentInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "That didn't look like something we could save.",
      },
      { status: 400 },
    );
  }

  const created = await addDevelopment(parsed.data);
  return NextResponse.json(created, { status: 201 });
}
