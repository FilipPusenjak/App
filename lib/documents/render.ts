// From a source snapshot to the content of a resume or brag sheet.
//
// Every word here is either the student's own (activities, facts, stories,
// skills) or a Common App description that already passed the fidelity check.
// Nothing is generated at this stage.
import { suggestSelection } from "./activities";
import {
  bragActivity,
  SECTION_TITLES,
  storyText,
  templateById,
} from "./brag-sheet";
import type { BragSheetFields, CommonAppFields, ResumeFields } from "./fields";
import { gradeLabel, RECOGNITION_LABELS } from "./limits";
import {
  BODY,
  blockBuilder,
  drawBlocks,
  HEADING,
  newDocument,
  TITLE,
  type Block,
} from "./pdf-text";
import type { ResumeContact, ResumeContent } from "./resume-pdf";
import type { SourceSnapshot } from "./store";

function grades(levels: number[]): string {
  if (levels.length === 0) return "";
  return levels.length === 1
    ? `Grade ${gradeLabel(levels[0]!)}`
    : `Grades ${gradeLabel(levels[0]!)}–${gradeLabel(levels[levels.length - 1]!)}`;
}

/**
 * The resume's content, best activities first so that cutting for length
 * removes the lowest-scored. A bullet is the activity's Common App description
 * when one was generated or written and is not flagged; otherwise the
 * student's own facts, verbatim.
 */
export function buildResumeContent(
  snapshot: SourceSnapshot,
  resume: ResumeFields,
  commonApp: CommonAppFields | null,
  contact: ResumeContact,
): ResumeContent {
  const ranked = suggestSelection(snapshot.activities, {
    maxActivities: snapshot.activities.length,
    intendedMajor: snapshot.student.intendedMajor,
  }).order;
  const byId = new Map(snapshot.activities.map((a) => [a.id, a]));

  const activities = ranked.map((id) => {
    const a = byId.get(id)!;
    const entry = commonApp?.entries[id];
    const usable =
      entry &&
      entry.description.trim() &&
      (entry.descriptionStatus === "generated" || entry.descriptionStatus === "edited");
    const bullets = usable ? [entry.description.trim()] : a.facts.slice(0, 3);
    const meta = [
      grades(a.gradeLevels),
      a.hoursPerWeek != null ? `${Math.round(a.hoursPerWeek)} hrs/week` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id,
      title: a.title,
      subtitle: [a.positionTitle, a.org].filter(Boolean).join(", "),
      meta,
      bullets,
    };
  });

  const detail = [
    snapshot.student.graduationYear ? `Expected graduation ${snapshot.student.graduationYear}` : null,
    resume.includeGpa && snapshot.student.gpa != null
      ? `GPA ${snapshot.student.gpa}${snapshot.student.gpaScale ? ` / ${snapshot.student.gpaScale}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    contact,
    education: { school: snapshot.student.schoolName, detail: detail || null },
    activities,
    honors: snapshot.honors.map((h) => ({
      title: h.title,
      meta: [RECOGNITION_LABELS[h.recognitionLevel], grades(h.gradeLevels)].filter(Boolean).join(", "),
    })),
    skills: resume.skills,
  };
}

/** The brag sheet as a PDF: the template's sections, in the template's order. */
export async function renderBragSheetPdf(snapshot: SourceSnapshot, fields: BragSheetFields) {
  const template = templateById(fields.templateId);
  const name = snapshot.student.name ?? "Brag sheet";
  const { doc, fonts } = await newDocument(`${name} — Brag sheet`);
  const { para, state } = blockBuilder(fonts);
  const blocks: Block[] = [
    {
      spaceBefore: 0,
      lines: [
        ...para(snapshot.student.name ?? "Brag sheet", "bold", TITLE),
        ...para(
          [snapshot.student.schoolName, snapshot.student.gradeLevel].filter(Boolean).join(" · ") ||
            "Brag sheet for recommenders",
          "regular",
          BODY,
        ),
      ],
    },
  ];
  const section = (title: string) => blocks.push({ spaceBefore: 12, lines: para(title.toUpperCase(), "bold", HEADING) });

  for (const s of template.sections) {
    if (s === "activities" && snapshot.activities.length) {
      section(SECTION_TITLES.activities);
      // Same ranking as the resume, so a recommender reads the strongest first.
      const ranked = suggestSelection(snapshot.activities, {
        maxActivities: snapshot.activities.length,
        intendedMajor: snapshot.student.intendedMajor,
      }).order;
      const byId = new Map(snapshot.activities.map((a) => [a.id, a]));
      for (const a of ranked.map((id) => bragActivity(byId.get(id)!))) {
        blocks.push({
          spaceBefore: 4,
          lines: [
            ...para(a.title, "bold", BODY),
            ...(a.detailLine ? para(a.detailLine, "regular", BODY) : []),
            ...(a.description ? para(a.description, "regular", BODY, 10) : []),
            ...a.facts.flatMap((f) => para(`•  ${f}`, "regular", BODY, 10)),
          ],
        });
      }
    }
    if (s === "academics") {
      const lines = [
        ...(snapshot.student.gpa != null
          ? [`GPA: ${snapshot.student.gpa}${snapshot.student.gpaScale ? ` / ${snapshot.student.gpaScale}` : ""}`]
          : []),
        ...snapshot.courses.map((c) => (c.org ? `${c.title} — ${c.org}` : c.title)),
        ...snapshot.testScores.map(
          (t) => `${t.label}: ${t.score}${t.maxScore ? ` / ${t.maxScore}` : ""}${t.predicted ? " (predicted)" : ""}`,
        ),
      ];
      if (lines.length) {
        section(SECTION_TITLES.academics);
        blocks.push({ spaceBefore: 2, lines: lines.flatMap((l) => para(l, "regular", BODY)) });
      }
    }
    if (s === "stories") {
      const answered = template.prompts.filter((p) => storyText(fields, p.id).trim());
      if (answered.length) {
        section(SECTION_TITLES.stories);
        for (const p of answered) {
          blocks.push({
            spaceBefore: 4,
            // The student's own paragraph breaks are kept; the stored text is
            // untouched either way.
            lines: [
              ...para(p.question, "bold", BODY),
              ...storyText(fields, p.id)
                .split(/\n\s*\n|\n/)
                .filter((line) => line.trim())
                .flatMap((line) => para(line, "regular", BODY)),
            ],
          });
        }
      }
    }
    if (s === "applying") {
      const lines = [
        ...(snapshot.student.intendedMajor ? [`Intended major: ${snapshot.student.intendedMajor}`] : []),
        ...(snapshot.student.careerGoal ? [`Career goal: ${snapshot.student.careerGoal}`] : []),
        ...snapshot.targets.map((t) => (t.course ? `${t.name} — ${t.course}` : t.name)),
      ];
      if (lines.length) {
        section(SECTION_TITLES.applying);
        blocks.push({ spaceBefore: 2, lines: lines.flatMap((l) => para(l, "regular", BODY)) });
      }
    }
  }

  drawBlocks(doc, fonts, blocks);
  return { bytes: await doc.save(), replacedCharacters: state.replaced };
}
