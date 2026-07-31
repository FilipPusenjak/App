// Structured-output plumbing shared by /api/evaluate and /api/project.
//
// Both routes ask the model for JSON constrained to a Zod schema. That
// constraint is compiled server-side into a decoding grammar, and the grammar
// has a size limit that is not published as a number — you discover it by
// crossing it, and when you do the API rejects the request outright:
//
//   400 invalid_request_error — "The compiled grammar is too large, which
//   would cause performance issues. Simplify your tool schemas or reduce the
//   number of strict tools."
//
// That is a request-time rejection, before a single token is generated, so it
// takes down every evaluation at once and costs nothing to retry. Two things
// here guard against it:
//
//   1. isGrammarTooLargeError() recognizes it, so a route can drop the grammar
//      and ask for the same JSON in the prompt instead. Losing the grammar
//      loses a generation-time guarantee, not a safety one — both routes
//      validate every response with Zod before anything is stored, and that
//      check is unchanged.
//   2. renderSchemaInstructions() writes the schema into the prompt for that
//      fallback path.
//
// The real fix is keeping the schema small (see lib/validation/evaluation-wire),
// but a size limit nobody can measure locally needs a floor under it too.

/**
 * Does this error mean the API refused the schema itself, rather than the
 * request's content?
 *
 * Deliberately narrow. A fallback that swallowed any 400 would hide genuine
 * bugs behind a silent, less-constrained retry.
 */
export function isGrammarTooLargeError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status !== 400) return false;

  const text = errorText(error).toLowerCase();
  if (!text) return false;

  if (text.includes("grammar is too large")) return true;
  // Same failure, in case the wording changes.
  return (
    (text.includes("grammar") || text.includes("schema")) &&
    (text.includes("too large") ||
      text.includes("too complex") ||
      text.includes("too many"))
  );
}

/** Every string an SDK error might have hidden the API's message in. */
function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;

  const parts: string[] = [];
  const err = error as {
    message?: unknown;
    error?: { message?: unknown; error?: { message?: unknown } };
  };
  if (typeof err.message === "string") parts.push(err.message);
  if (typeof err.error?.message === "string") parts.push(err.error.message);
  if (typeof err.error?.error?.message === "string") {
    parts.push(err.error.error.message);
  }
  return parts.join(" ");
}

/**
 * The instructions that replace the grammar when it has to be dropped.
 *
 * `schema` is the same JSON Schema that would have been sent as
 * output_config.format, so the shape asked for is identical either way.
 */
export function renderSchemaInstructions(schema: unknown): string {
  return `# Output format

Return a SINGLE JSON object and nothing else. No prose before or after it, no explanation, no markdown code fences.

It must match this JSON Schema exactly — every property listed in "required" must be present, and no properties may be added beyond those listed:

${JSON.stringify(schema, null, 2)}

Where a property's description reads {enum: [...]}, its value must be exactly one of those strings.`;
}

/**
 * Pull the JSON object out of a model response.
 *
 * On the constrained path the text is already bare JSON and this returns it
 * unchanged. On the fallback path a model occasionally wraps it in a code
 * fence or adds a line of preamble despite being told not to, and throwing
 * that response away would be a worse outcome than trimming it.
 *
 * The fence is only stripped when the response OPENS with one. An earlier
 * version matched a fence anywhere, which would have quietly sliced a valid
 * response in half if any string value inside it happened to contain a triple
 * backtick — advice about code very plausibly does.
 */
export function extractJsonObject(text: string): string | null {
  let body = text.trim();
  if (!body) return null;

  if (body.startsWith("```")) {
    const opened = body.replace(/^```[a-z]*\s*/i, "");
    const closed = opened.lastIndexOf("```");
    body = (closed === -1 ? opened : opened.slice(0, closed)).trim();
  }

  const start = body.indexOf("{");
  if (start === -1) return null;

  // Scan for the brace that closes the FIRST object, respecting strings and
  // escapes, so trailing commentary is dropped rather than swallowed. Falling
  // back to the last brace would turn "{...} Hope this helps! }" into a parse
  // error instead of a result.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return body.slice(start, i + 1);
  }

  return null;
}

/** What one attempt at a structured response produced. */
export type ModelAttempt = {
  /** Concatenated text blocks. */
  text: string;
  /** False when the grammar had to be dropped — the first thing to know. */
  constrained: boolean;
  stopReason: string | null;
};

export type ParsedAttempt<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

/** Just enough of a Zod schema to validate with, without importing zod here. */
type Validator<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
};

/**
 * Turn one attempt into either a validated result or a reason it was unusable.
 *
 * The reason is written to be read by two audiences at once: the student, in
 * their evaluation history, and whoever has to debug it. So it names the path,
 * the stop reason, and — when the failure was the JSON itself — what actually
 * came back.
 */
export function parseModelJson<T>(
  schema: Validator<T>,
  attempt: ModelAttempt,
  subject: string,
): ParsedAttempt<T> {
  const where = `${attempt.constrained ? "constrained" : "prompt-only"}, stop_reason: ${attempt.stopReason}`;

  if (!attempt.text.trim()) {
    return { ok: false, reason: `The model returned an empty response [${where}].` };
  }

  const json = extractJsonObject(attempt.text);
  let raw: unknown;
  try {
    if (json === null) throw new Error("no complete JSON object in the response");
    raw = JSON.parse(json);
  } catch {
    return {
      ok: false,
      reason: `The model returned output that was not valid JSON [${where}]. Response began: ${responseExcerpt(attempt.text)}`,
    };
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  const issues = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    reason: `The ${subject} did not match the expected schema [${where}] (${issues}).`,
  };
}

/**
 * The correction appended to the prompt on a second attempt.
 *
 * Generation is stochastic: one malformed response does not mean the next one
 * will be malformed, and losing a whole evaluation to a single bad roll is a
 * far worse outcome than one extra request. Telling the model what was wrong
 * with the last attempt makes the retry meaningfully better than a coin flip.
 */
export function renderRetryNote(reason: string): string {
  return `# Your previous response could not be used

${reason}

Answer again. Return ONE complete JSON object matching the schema and NOTHING else — no preamble, no commentary after it, no markdown code fences. Every required property must be present, and the object must be closed.`;
}

/**
 * A short, safe excerpt of a response that could not be used.
 *
 * When parsing fails, the response itself is the only evidence of why, and
 * discarding it leaves nothing to debug but "it didn't work". This is stored
 * on the student's own failed evaluation row — the same ownership scope as
 * every other field on it — and truncated so a runaway response cannot bloat
 * the table.
 */
export function responseExcerpt(text: string, limit = 600): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "(empty)";
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit)}… [${collapsed.length} chars total]`;
}
