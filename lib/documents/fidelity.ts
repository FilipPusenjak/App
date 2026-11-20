// Did a generated text add anything the student did not enter?
//
// The document builder's one rule is that the model may compress and rephrase
// but never add. A prompt can ask for that; only code can check it. This runs
// on every generated description and grammar fix, and anything it flags is
// regenerated once and then handed to the student with the offending word
// named — never silently accepted.
//
// It is deliberately conservative. A false alarm costs the student a glance; a
// missed invented number costs them their integrity on an application.
//
// Pure: no database, no model.

export type FidelityViolation = {
  kind: "number" | "proper_noun" | "verb";
  /** The word as it appears in the output — shown to the student. */
  token: string;
  message: string;
};

/**
 * Verbs that upgrade what someone did, each with the source words that would
 * justify it. "Attended weekly meetings" must not become "Led weekly
 * initiatives"; "president of the club" can become "led the club".
 *
 * Configurable: pass a different list to checkFidelity. Every form is matched
 * as a whole word, case-insensitively.
 */
export type InflationVerb = { label: string; forms: string[]; supportedBy: string[] };

const LEADERSHIP_WORDS = [
  "lead", "leads", "led", "leader", "leaders", "leadership", "leading",
  "president", "vice-president", "captain", "co-captain", "chair", "chairs",
  "chairperson", "head", "director", "coordinator", "organizer", "organiser",
  "officer", "editor-in-chief", "founder", "co-founder", "manager", "managed",
  "ran", "run", "runs", "running",
];

export const DEFAULT_INFLATION_VERBS: InflationVerb[] = [
  { label: "led", forms: ["led", "lead", "leads", "leading"], supportedBy: LEADERSHIP_WORDS },
  {
    label: "founded",
    forms: ["founded", "co-founded", "founder", "co-founder", "founding"],
    supportedBy: ["found", "founded", "co-founded", "founder", "co-founder", "founding", "started", "start", "began", "begun", "established", "created", "launched"],
  },
  {
    label: "spearheaded",
    forms: ["spearheaded", "spearheading", "spearhead"],
    supportedBy: ["spearheaded", "spearhead", ...LEADERSHIP_WORDS],
  },
  {
    label: "directed",
    forms: ["directed", "directing", "direct", "directs"],
    supportedBy: ["direct", "directed", "director", "directing", ...LEADERSHIP_WORDS],
  },
  {
    label: "organized",
    forms: ["organized", "organised", "organizing", "organising", "organize", "organise", "organizer", "organiser"],
    supportedBy: ["organize", "organized", "organise", "organised", "organizer", "organiser", "organizing", "organising", "coordinated", "coordinate", "coordinator", "planned", "arranged", "ran", "run", "hosted"],
  },
  {
    label: "launched",
    forms: ["launched", "launching", "launch", "launches"],
    supportedBy: ["launch", "launched", "launching", "released", "release", "published", "started", "founded", "opened"],
  },
  {
    label: "managed",
    forms: ["managed", "managing", "manage", "manages", "manager"],
    supportedBy: ["manage", "managed", "manager", "managing", "ran", "run", "oversaw", "oversee", "supervised", "supervise", "coordinated", "in charge"],
  },
  // Recognition and promotion are outcome claims too: the spec's "no
  // outcomes or recognition that are not in the source".
  {
    label: "won",
    forms: ["won", "winner", "winning", "awarded", "award-winning"],
    supportedBy: ["won", "win", "wins", "winner", "winning", "award", "awarded", "prize", "medal", "champion", "championship", "place", "finalist", "honorable"],
  },
  {
    label: "promoted",
    forms: ["promoted", "promotion"],
    supportedBy: ["promoted", "promotion", "asked to take on", "became", "moved up"],
  },
  {
    label: "created",
    forms: ["created", "creating", "create", "creates", "creator"],
    supportedBy: ["create", "created", "creating", "creator", "made", "make", "built", "build", "designed", "design", "wrote", "write", "written", "developed", "develop", "coded", "programmed", "composed", "produced", "founded", "started", "drew", "painted"],
  },
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, twelfth: 12,
  once: 1, twice: 2, dozen: 12, half: 0.5,
};

function normalizeNumber(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
}

/** Every number in a text, digits and number words both, normalized. */
function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.add(normalizeNumber(m[0]));
  for (const w of text.toLowerCase().matchAll(/[a-z]+/g)) {
    if (w[0] in NUMBER_WORDS) found.add(String(NUMBER_WORDS[w[0]]));
  }
  return found;
}

function words(text: string): Set<string> {
  return new Set(
    (
      text
        .toLowerCase()
        .replace(/[’']s\b/g, "")
        .match(/[a-z0-9][a-z0-9.&+-]*/g) ?? []
    ).map((w) => w.replace(/[.&+-]+$/, "")),
  );
}

/** Whether a phrase (one or more words) appears in the source, as whole words. */
function sourceHas(sourceLower: string, sourceWords: Set<string>, phrase: string): boolean {
  const p = phrase.toLowerCase();
  if (!p.includes(" ")) return sourceWords.has(p);
  return new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(sourceLower);
}

/**
 * Capitalized words that are not just the start of a sentence or fragment —
 * names, places, programs, acronyms. Fragment style capitalizes the first word
 * of every fragment, so those are skipped unless they are acronyms.
 */
function properNounCandidates(output: string): string[] {
  const out: string[] = [];
  for (const fragment of output.split(/[.;:!?\n•|]|\s[-–—]\s/)) {
    const tokens = fragment.trim().split(/\s+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const tok = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").replace(/[’']s$/, "");
      if (!tok || tok === "I") return;
      const isAcronym = /^[A-Z][A-Z0-9&.]+$/.test(tok) && tok.replace(/[^A-Z]/g, "").length >= 2;
      const isCapitalized = /^[A-Z]/.test(tok);
      if (isAcronym || (isCapitalized && i > 0)) out.push(tok);
    });
  }
  return out;
}

/**
 * Compare a generated text against everything the student entered.
 *
 * `sourceTexts` should be every field the generation was allowed to see — for
 * a description, fidelitySourceText() in activities.ts.
 */
export function checkFidelity(
  output: string,
  sourceTexts: string[],
  verbs: InflationVerb[] = DEFAULT_INFLATION_VERBS,
): FidelityViolation[] {
  const source = sourceTexts.join("\n");
  const sourceLower = source.toLowerCase();
  const sourceWords = words(source);
  const sourceNumbers = numbersIn(source);
  const violations: FidelityViolation[] = [];
  const seen = new Set<string>();
  const add = (v: FidelityViolation) => {
    const key = `${v.kind}:${v.token.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push(v);
    }
  };

  // 1. Numbers. Digits must appear in the source as digits or words, and so
  //    must number words — "three" is as much a claim as "3".
  for (const m of output.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (!sourceNumbers.has(normalizeNumber(m[0]))) {
      add({ kind: "number", token: m[0], message: `"${m[0]}" is not a number you entered.` });
    }
  }
  for (const m of output.matchAll(/[A-Za-z]+/g)) {
    const w = m[0].toLowerCase();
    if (w in NUMBER_WORDS && !["once", "half"].includes(w) && !sourceNumbers.has(String(NUMBER_WORDS[w]))) {
      add({ kind: "number", token: m[0], message: `"${m[0]}" is not a number you entered.` });
    }
  }

  // 2. Proper nouns and acronyms must be names the student used.
  for (const tok of properNounCandidates(output)) {
    if (/^\d/.test(tok)) continue;
    if (!sourceHas(sourceLower, sourceWords, tok)) {
      add({ kind: "proper_noun", token: tok, message: `"${tok}" isn't a name you entered.` });
    }
  }

  // 3. Verbs that claim more than the source does.
  const outputWords = words(output);
  for (const verb of verbs) {
    const used = verb.forms.find((f) => outputWords.has(f));
    if (!used) continue;
    const supported = verb.supportedBy.some((w) => sourceHas(sourceLower, sourceWords, w));
    if (!supported) {
      const shown = output.match(new RegExp(`\\b${used}\\b`, "i"))?.[0] ?? used;
      add({
        kind: "verb",
        token: shown,
        message:
          verb.label === "led"
            ? `"${shown}" claims leadership, and nothing you entered says so.`
            : verb.label === "won"
              ? `"${shown}" claims recognition, and nothing you entered says so.`
              : verb.label === "promoted"
                ? `"${shown}" claims a promotion, and nothing you entered says so.`
                : `"${shown}" says you ${verb.label} something, and nothing you entered says so.`,
      });
    }
  }

  return violations;
}
