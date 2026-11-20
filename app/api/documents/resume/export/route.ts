// Export the resume PDF.
//
// CONTACT DETAILS ARE NOT KEPT. They arrive with this request, are used to draw
// the page, and are gone when it returns — not in the export snapshot, not in
// the draft, not in a log. Only an explicit "remember for next time" writes
// them, to SavedResumeContact; exporting without it deletes anything saved
// before. Users are minors, and a phone number and address are not something
// to hold between sessions without asking.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import type { CommonAppFields, ResumeFields } from "@/lib/documents/fields";
import { exportDraft, getOrCreateDraft, loadSourceSnapshot } from "@/lib/documents/store";
import { buildResumeContent } from "@/lib/documents/render";
import { renderResumePdf } from "@/lib/documents/resume-pdf";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

const contactSchema = z.object({
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  const contact = contactSchema.safeParse(body.contact ?? {});
  if (!contact.success) return badRequest("Check your contact details.");
  const remember = body.remember === true;

  const cycle = currentCycle();
  const snapshot = await loadSourceSnapshot(gate.profileId, cycle);
  const draft = await getOrCreateDraft(gate.profileId, "RESUME_PDF", cycle);
  const commonApp = await prisma.applicationDocument.findUnique({
    where: { draftKey: `${gate.profileId}:COMMON_APP_ACTIVITIES:${cycle}` },
    select: { fields: true },
  });

  const c = contact.data;
  const content = buildResumeContent(
    snapshot,
    draft.fields as unknown as ResumeFields,
    (commonApp?.fields as unknown as CommonAppFields) ?? null,
    { name: c.name || snapshot.student.name || "", email: c.email, phone: c.phone, address: c.address },
  );
  const pdf = await renderResumePdf(content);

  if (remember) {
    const saved = { name: c.name || null, email: c.email || null, phone: c.phone || null, address: c.address || null };
    await prisma.savedResumeContact.upsert({
      where: { profileId: gate.profileId },
      create: { profileId: gate.profileId, ...saved },
      update: saved,
    });
  } else {
    await prisma.savedResumeContact.deleteMany({ where: { profileId: gate.profileId } });
  }

  const droppedTitles = pdf.dropped.map((id) => content.activities.find((a) => a.id === id)?.title ?? id);
  try {
    // What was actually on the page, without a single contact detail.
    const exported = await exportDraft(draft.id, {
      fieldsOverride: {
        ...(draft.fields as unknown as ResumeFields),
        printed: {
          education: content.education,
          activities: content.activities.filter((a) => !pdf.dropped.includes(a.id)),
          honors: content.honors.filter((h) => !pdf.droppedHonors.includes(h.title)),
          skills: content.skills,
        },
        droppedActivityIds: pdf.dropped,
        droppedHonors: pdf.droppedHonors,
      },
    });
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="resume.pdf"',
        "X-Export-Id": exported.id,
        "X-Dropped": encodeURIComponent(JSON.stringify([...droppedTitles, ...pdf.droppedHonors])),
        "X-Replaced-Characters": pdf.replacedCharacters ? "1" : "0",
      },
    });
  } catch (err) {
    return handleStoreError(err);
  }
}
