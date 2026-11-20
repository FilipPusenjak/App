// Grammar fixes for brag-sheet stories, and the check that they are ONLY that.
//
// Opt-in, per student. The correction is shown beside the original and
// replaces nothing until accepted. The check below is the guarantee that a
// "grammar fix" did not quietly become a rewrite: it may change spelling,
// punctuation, capitalization and small connecting words, and nothing else.
import { checkFidelity, type FidelityViolation } from "./fidelity";

export const GRAMMAR_PROMPT_VERSION = "documents/grammar-v1";

export const GRAMMAR_SYSTEM_PROMPT = `Correct the spelling, grammar and punctuation of the student's text.

Change nothing else. Do not add words, facts, details, adjectives or feelings. Do not remove anything the student said. Do not make it sound more impressive. Keep their voice, their wording and their order. If the text is already correct, return it unchanged.

Return only the corrected text, with no commentary.`;

/** Words a grammar fix may add or remove without changing what is said. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "am",
  "it", "its", "that", "this", "i", "my", "me", "we", "our", "us", "they", "their",
  "he", "she", "his", "her", "had", "have", "has", "did", "do", "does", "not",
  "which", "who", "when", "then", "than", "also", "very",
]);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []).map((t) => t.replace(/'s$/, ""));
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

const sortedLetters = (w: string) => [...w].sort().join("");

/**
 * Is `w` the same word as something in `pool`, allowing for a misspelling?
 * Short words get less room, because a one-letter change to a short word is
 * usually a different word ("cat", "bat"): three letters may only be
 * transposed ("teh"), four may differ by one edit, longer by two.
 */
function isSpellingOf(w: string, pool: Set<string>): boolean {
  if (pool.has(w)) return true;
  for (const p of pool) {
    const n = Math.min(p.length, w.length);
    if (n < 3) continue;
    const d = editDistance(p, w);
    if (n === 3 ? d <= 2 && p.length === w.length && sortedLetters(p) === sortedLetters(w) : n === 4 ? d <= 1 : d <= 2) {
      return true;
    }
  }
  return false;
}

export type GrammarCheck =
  | { ok: true }
  | { ok: false; added: string[]; removed: string[]; violations: FidelityViolation[] };

/**
 * Is `fixed` a grammar-only correction of `original`?
 *
 * Every content word in the correction must be in the original, or be a
 * spelling correction of a word that was (two edits or fewer). Every content
 * word in the original must survive the same way — a fix that drops something
 * the student said is not a fix. Plus the standard fidelity check.
 */
export function checkGrammarOnly(original: string, fixed: string): GrammarCheck {
  // Content words on each side are matched against EVERY word on the other:
  // "teh" corrected to "the" lands on a function word, and is still a fix.
  const allBefore = new Set(tokens(original));
  const allAfter = new Set(tokens(fixed));
  const content = (pool: Set<string>) => [...pool].filter((t) => !FUNCTION_WORDS.has(t));
  const added = content(allAfter).filter((w) => !isSpellingOf(w, allBefore));
  const removed = content(allBefore).filter((w) => !isSpellingOf(w, allAfter));
  const violations = checkFidelity(fixed, [original]);
  if (added.length === 0 && removed.length === 0 && violations.length === 0) return { ok: true };
  return { ok: false, added, removed, violations };
}
