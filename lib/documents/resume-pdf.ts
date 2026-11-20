// The one-page resume, drawn deterministically.
//
// Plain and machine-readable on purpose: one column, real text in a standard
// font, no icons, no graphics, no tables. Applicant-tracking systems read a
// resume as a stream of text, and anything clever about the layout is a thing
// they can misread.
//
// ONE PAGE, AND NEVER BY SHRINKING. Text is set at 10pt or larger. When the
// content does not fit, whole activities are cut, lowest-scored first, and the
// student is told which ones — a resume that fits because its text became too
// small to read has not fitted.
import {
  BODY,
  blockBuilder,
  drawBlocks,
  HEADING,
  heightOf,
  MARGIN,
  newDocument,
  PAGE,
  TITLE,
  type Block,
  type Fonts,
} from "./pdf-text";

export type ResumeContact = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type ResumeActivity = {
  id: string;
  title: string;
  /** "Position, Organization" as entered; either may be absent. */
  subtitle: string;
  /** "Grades 9–12 · 4 hrs/week" */
  meta: string;
  bullets: string[];
};

export type ResumeContent = {
  contact: ResumeContact;
  education: { school: string | null; detail: string | null };
  /** Highest-scored first: cutting for length removes from the end. */
  activities: ResumeActivity[];
  honors: { title: string; meta: string }[];
  skills: string[];
};

/** The smallest font size this renderer uses anywhere. Pinned by a test. */
export const MIN_FONT_SIZE = BODY;

function blocksFor(content: ResumeContent, fonts: Fonts) {
  const { para, state } = blockBuilder(fonts);
  const blocks: Block[] = [];
  const contactLine = [content.contact.email, content.contact.phone, content.contact.address]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join("  |  ");
  blocks.push({
    spaceBefore: 0,
    lines: [
      ...para(content.contact.name || "Your name", "bold", TITLE),
      ...(contactLine ? para(contactLine, "regular", BODY) : []),
    ],
  });
  const section = (title: string) =>
    blocks.push({ spaceBefore: 10, lines: para(title.toUpperCase(), "bold", HEADING) });

  if (content.education.school || content.education.detail) {
    section("Education");
    blocks.push({
      spaceBefore: 2,
      lines: [
        ...(content.education.school ? para(content.education.school, "bold", BODY) : []),
        ...(content.education.detail ? para(content.education.detail, "regular", BODY) : []),
      ],
    });
  }
  if (content.activities.length) {
    section("Activities");
    for (const a of content.activities) {
      blocks.push({
        spaceBefore: 4,
        lines: [
          ...para(a.title, "bold", BODY),
          ...(a.subtitle ? para(a.subtitle, "regular", BODY) : []),
          ...(a.meta ? para(a.meta, "regular", BODY) : []),
          ...a.bullets.flatMap((b) => para(`•  ${b}`, "regular", BODY, 10)),
        ],
      });
    }
  }
  if (content.honors.length) {
    section("Honors");
    for (const h of content.honors) {
      blocks.push({ spaceBefore: 2, lines: para(h.meta ? `${h.title} — ${h.meta}` : h.title, "regular", BODY) });
    }
  }
  if (content.skills.length) {
    section("Skills");
    blocks.push({ spaceBefore: 2, lines: para(content.skills.join(", "), "regular", BODY) });
  }
  return { blocks, replaced: state.replaced };
}

export type RenderedResume = {
  bytes: Uint8Array;
  /** Activity ids cut to keep it to one page, in the order they were cut. */
  dropped: string[];
  /** Honors cut after every activity was already gone. */
  droppedHonors: string[];
  /** True when some characters could not be drawn in the standard font. */
  replacedCharacters: boolean;
};

/** Cut whole items, lowest-scored first, until the content fits one page. */
export function fitToOnePage(content: ResumeContent, fonts: Fonts) {
  const available = PAGE.height - MARGIN * 2;
  const working: ResumeContent = { ...content, activities: [...content.activities], honors: [...content.honors] };
  const dropped: string[] = [];
  const droppedHonors: string[] = [];
  let built = blocksFor(working, fonts);
  while (heightOf(built.blocks) > available) {
    if (working.activities.length > 0) dropped.push(working.activities.pop()!.id);
    else if (working.honors.length > 0) droppedHonors.push(working.honors.pop()!.title);
    else break; // The header and skills alone overflow; drawn as far as they fit.
    built = blocksFor(working, fonts);
  }
  return { blocks: built.blocks, replaced: built.replaced, dropped, droppedHonors };
}

export async function renderResumePdf(content: ResumeContent): Promise<RenderedResume> {
  const { doc, fonts } = await newDocument(`${content.contact.name || "Resume"} — Resume`);
  const fitted = fitToOnePage(content, fonts);
  drawBlocks(doc, fonts, fitted.blocks, 1);
  return {
    bytes: await doc.save(),
    dropped: fitted.dropped,
    droppedHonors: fitted.droppedHonors,
    replacedCharacters: fitted.replaced,
  };
}
