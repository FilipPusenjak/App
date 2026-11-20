// The brag sheet: what a teacher or counselor reads before writing a
// recommendation.
//
// STORIES ARE THE STUDENT'S OWN WORDS. Every other section is assembled by
// code from the profile. The stories — the anecdotes a recommender is most
// likely to repeat — are typed by the student and stored exactly as typed. The
// model may correct their grammar only if they opt in, and even then the
// correction is offered beside the original, checked by grammar.ts, and never
// replaces anything until the student accepts it. A recommender repeating an
// invented anecdote is the worst failure this feature could have.
//
// TEMPLATES vary by school, so the section order and the story prompts are
// configuration, with one sensible default.
//
// Pure: no database, no model.
import { gradesPhrase, TIMING_LABELS, type Timing } from "./limits";
import type { ActivitySource } from "./activities";
import type { BragSheetFields } from "./fields";

export type BragSection = "activities" | "academics" | "stories" | "applying";

export type StoryPrompt = { id: string; question: string; hint?: string };

export type BragTemplate = {
  id: string;
  name: string;
  description: string;
  sections: BragSection[];
  prompts: StoryPrompt[];
};

export const BRAG_TEMPLATES: BragTemplate[] = [
  {
    id: "general",
    name: "General recommender",
    description: "For any teacher or counselor writing about you.",
    sections: ["activities", "academics", "stories", "applying"],
    prompts: [
      { id: "proud", question: "A moment in a class or activity you were proud of" },
      { id: "mention", question: "Something you'd like your recommender to mention" },
      { id: "challenge", question: "A challenge you worked through, and what you did about it" },
      { id: "outside", question: "Something about you that doesn't show up in your grades" },
    ],
  },
  {
    id: "teacher",
    name: "Teacher",
    description: "For a subject teacher. Leads with your academics and that class.",
    sections: ["academics", "stories", "activities", "applying"],
    prompts: [
      { id: "class_moment", question: "A moment in this teacher's class you were proud of" },
      { id: "class_beyond", question: "Something you did or learned in this class beyond the assignments" },
      { id: "mention", question: "Something you'd like this teacher to mention" },
    ],
  },
  {
    id: "counselor",
    name: "School counselor",
    description: "For your school counselor's letter. Leads with what you're applying for.",
    sections: ["applying", "activities", "academics", "stories"],
    prompts: [
      { id: "proud", question: "Something from high school you're proud of" },
      {
        id: "context",
        question: "Anything about your circumstances you'd like your counselor to know",
        hint: "Only if you want them to know. Leave it blank otherwise.",
      },
      { id: "mention", question: "Something you'd like your counselor to mention" },
    ],
  },
];

export const DEFAULT_BRAG_TEMPLATE_ID = "general";

export function templateById(id: string | null | undefined): BragTemplate {
  return BRAG_TEMPLATES.find((t) => t.id === id) ?? BRAG_TEMPLATES[0]!;
}

export const SECTION_TITLES: Record<BragSection, string> = {
  activities: "Activities",
  academics: "Academic highlights",
  stories: "In my own words",
  applying: "What I'm applying for",
};

export type BragActivity = {
  title: string;
  detailLine: string;
  facts: string[];
  description: string | null;
};

/** One activity as a recommender reads it — every word from the profile. */
export function bragActivity(a: ActivitySource): BragActivity {
  const bits = [
    a.positionTitle,
    a.org,
    a.gradeLevels.length ? gradesPhrase(a.gradeLevels) : null,
    a.hoursPerWeek != null ? `${a.hoursPerWeek} hrs/week` : null,
    a.weeksPerYear != null ? `${a.weeksPerYear} weeks/year` : null,
    a.timing ? (TIMING_LABELS[a.timing as Timing] ?? null) : null,
  ].filter(Boolean);
  return {
    title: a.title,
    detailLine: bits.join(" · "),
    facts: a.facts,
    description: a.description?.trim() || null,
  };
}

/**
 * The text a story prints as: the student's own, unless they accepted a
 * grammar correction — in which case that accepted text IS now their text,
 * because accepting it is an edit they made.
 */
export function storyText(fields: BragSheetFields, promptId: string): string {
  return fields.stories[promptId]?.text ?? "";
}
