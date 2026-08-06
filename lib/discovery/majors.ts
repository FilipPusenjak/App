// Subject taxonomy for Activity Discovery.
//
// `Profile.intendedMajor` is free text — "Medicine", "pre-med", "med school",
// "Biomedical Sciences". Cohorts cannot be built from that: string-matching
// would put "pre-med" and "Medicine" in different groups and quietly halve
// both, which for a k-anonymity feature means two cohorts below the floor
// instead of one above it.
//
// So free text is normalized to a fixed CATEGORY, and categories roll up into
// broader GROUPS for the third rung of the widening ladder.
//
// Deliberately a static table rather than a database model, matching how the
// rubrics are done: it is a fixed vocabulary the code reasons about, it needs
// no per-row lifecycle, and keeping it in the repo means a change to it is a
// reviewed diff rather than an unlogged row edit.
//
// Matching is intentionally conservative. An unrecognised subject maps to null,
// which keeps that student OUT of every subject cohort. That is the safe
// failure: being absent from an aggregate costs a student nothing, while being
// counted in the wrong one both misinforms them and pollutes a group they are
// not part of.
import { z } from "zod";

export const MAJOR_GROUPS = [
  "stem",
  "health",
  "social_science",
  "humanities",
  "business",
  "creative",
] as const;
export type MajorGroup = (typeof MAJOR_GROUPS)[number];
export const MAJOR_GROUP_LABELS: Record<MajorGroup, string> = {
  stem: "Science, technology, engineering & maths",
  health: "Medicine & health",
  social_science: "Social sciences",
  humanities: "Humanities",
  business: "Business & economics",
  creative: "Creative & performing arts",
};

export const MAJOR_CATEGORIES = [
  "medicine",
  "nursing_allied_health",
  "biology_life_sciences",
  "chemistry",
  "physics_astronomy",
  "mathematics",
  "computer_science",
  "engineering",
  "environmental_earth",
  "psychology",
  "economics",
  "business_management",
  "law",
  "politics_international",
  "sociology_anthropology",
  "history",
  "languages_literature",
  "philosophy_religion",
  "art_design",
  "music",
  "drama_film",
  "architecture",
  "education",
] as const;
export const majorCategorySchema = z.enum(MAJOR_CATEGORIES);
export type MajorCategory = (typeof MAJOR_CATEGORIES)[number];

export const MAJOR_CATEGORY_LABELS: Record<MajorCategory, string> = {
  medicine: "Medicine",
  nursing_allied_health: "Nursing & allied health",
  biology_life_sciences: "Biology & life sciences",
  chemistry: "Chemistry",
  physics_astronomy: "Physics & astronomy",
  mathematics: "Mathematics",
  computer_science: "Computer science",
  engineering: "Engineering",
  environmental_earth: "Environmental & earth sciences",
  psychology: "Psychology",
  economics: "Economics",
  business_management: "Business & management",
  law: "Law",
  politics_international: "Politics & international relations",
  sociology_anthropology: "Sociology & anthropology",
  history: "History",
  languages_literature: "Languages & literature",
  philosophy_religion: "Philosophy & religion",
  art_design: "Art & design",
  music: "Music",
  drama_film: "Drama & film",
  architecture: "Architecture",
  education: "Education",
};

export const MAJOR_CATEGORY_GROUP: Record<MajorCategory, MajorGroup> = {
  medicine: "health",
  nursing_allied_health: "health",
  biology_life_sciences: "stem",
  chemistry: "stem",
  physics_astronomy: "stem",
  mathematics: "stem",
  computer_science: "stem",
  engineering: "stem",
  environmental_earth: "stem",
  psychology: "social_science",
  economics: "business",
  business_management: "business",
  law: "social_science",
  politics_international: "social_science",
  sociology_anthropology: "social_science",
  history: "humanities",
  languages_literature: "humanities",
  philosophy_religion: "humanities",
  art_design: "creative",
  music: "creative",
  drama_film: "creative",
  architecture: "creative",
  education: "social_science",
};

/**
 * Phrases that map to each category, lowercase, matched as whole words.
 *
 * Order within a category does not matter; order BETWEEN categories does, and
 * is handled by scoring the longest match — "biomedical engineering" must not
 * be captured by the "medic" of some looser rule. Whole-word matching is what
 * stops "art" matching inside "arts" of "martial arts", and "law" inside
 * "flawless".
 */
const SYNONYMS: Record<MajorCategory, string[]> = {
  medicine: ["medicine", "medical", "pre-med", "premed", "pre med", "mbbs", "md", "doctor", "surgeon", "medic"],
  nursing_allied_health: ["nursing", "nurse", "midwifery", "physiotherapy", "physical therapy", "pharmacy", "dentistry", "dental", "veterinary", "vet med", "optometry", "radiography", "paramedic", "public health"],
  biology_life_sciences: ["biology", "biological sciences", "biomedical science", "biomedicine", "biochemistry", "genetics", "neuroscience", "microbiology", "zoology", "botany", "life sciences", "biotechnology"],
  // NOT "chemical engineering" — that is an engineering discipline, and
  // listing it here would let the longest-match rule pull it out of
  // engineering, which is the opposite of what that rule is for.
  chemistry: ["chemistry", "chemical sciences"],
  physics_astronomy: ["physics", "astrophysics", "astronomy", "cosmology", "space science"],
  mathematics: ["mathematics", "maths", "math", "applied mathematics", "pure mathematics", "statistics", "actuarial science"],
  computer_science: ["computer science", "computing", "software engineering", "software development", "informatics", "artificial intelligence", "machine learning", "data science", "cybersecurity", "cs"],
  engineering: ["engineering", "mechanical engineering", "electrical engineering", "civil engineering", "aerospace engineering", "aeronautical", "robotics", "mechatronics"],
  environmental_earth: ["environmental science", "environmental studies", "geology", "geoscience", "earth science", "climate science", "ecology", "marine biology", "oceanography", "geography"],
  psychology: ["psychology", "psychological sciences", "cognitive science", "behavioural science", "behavioral science"],
  economics: ["economics", "econometrics", "political economy", "ppe"],
  business_management: ["business", "business administration", "management", "finance", "accounting", "marketing", "entrepreneurship", "commerce", "supply chain"],
  law: ["law", "llb", "legal studies", "jurisprudence", "criminology"],
  politics_international: ["politics", "political science", "international relations", "international studies", "government", "public policy", "diplomacy"],
  sociology_anthropology: ["sociology", "anthropology", "social work", "social policy", "development studies", "gender studies"],
  history: ["history", "ancient history", "archaeology", "art history", "classics"],
  languages_literature: ["english", "english literature", "literature", "linguistics", "modern languages", "french", "spanish", "german", "mandarin", "japanese", "translation", "comparative literature", "creative writing", "journalism"],
  philosophy_religion: ["philosophy", "theology", "religious studies", "divinity", "ethics"],
  art_design: ["art", "fine art", "design", "graphic design", "industrial design", "fashion", "illustration", "animation", "photography"],
  music: ["music", "musicology", "composition", "performance music", "music technology"],
  drama_film: ["drama", "theatre", "theater", "acting", "film", "film studies", "cinema", "media studies", "screenwriting"],
  architecture: ["architecture", "architectural studies", "urban planning", "landscape architecture"],
  education: ["education", "teaching", "primary education", "secondary education", "pedagogy"],
};

/** Whole-word, punctuation-tolerant containment. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * Map free-text `intendedMajor` to a category, or null when nothing matches
 * confidently.
 *
 * The LONGEST matching phrase wins across all categories. That is what keeps
 * "biomedical engineering" in engineering rather than being pulled into
 * medicine by a shorter, looser synonym, and "chemical engineering" out of
 * chemistry. Ties are broken by category order, which is stable so two runs
 * over the same input always agree — a cohort that shifted between queries
 * would be probeable.
 */
export function categorizeMajor(
  intendedMajor: string | null | undefined,
): MajorCategory | null {
  if (!intendedMajor) return null;
  const text = intendedMajor.toLowerCase().trim();
  if (!text) return null;

  let best: { category: MajorCategory; length: number } | null = null;
  for (const category of MAJOR_CATEGORIES) {
    for (const phrase of SYNONYMS[category]) {
      if (!containsPhrase(text, phrase)) continue;
      if (!best || phrase.length > best.length) {
        best = { category, length: phrase.length };
      }
    }
  }
  return best?.category ?? null;
}

/** The broader group a category rolls up into, for ladder rung 3. */
export function groupForMajor(
  category: MajorCategory | null | undefined,
): MajorGroup | null {
  if (!category) return null;
  return MAJOR_CATEGORY_GROUP[category] ?? null;
}

/** Every category sharing a group — the membership of a rung-3 cohort. */
export function categoriesInGroup(group: MajorGroup): MajorCategory[] {
  return MAJOR_CATEGORIES.filter((c) => MAJOR_CATEGORY_GROUP[c] === group);
}
