// Shape and limits for what a student reports, with NO server imports.
//
// Split out from lib/developments.ts for a reason that is invisible until it
// breaks the whole app: the composer is a client component, and a client
// component that imports the data-access module pulls `@/lib/db` with it —
// which pulls the Prisma adapter, which pulls `pg`, which tries to resolve
// `dns` and `fs` in a browser bundle. Next then fails to compile every page,
// not just this one.
//
// So anything a client needs lives here, and anything that touches the database
// lives there. The rule is one-directional: lib/developments imports this file,
// never the reverse.
import { z } from "zod";

/**
 * Short by design.
 *
 * A fortnight's news, not an essay and not a diary. The limit is a product
 * decision rather than a storage one: an unbounded box invites a journal, a
 * journal invites the app to become something it has no business being, and the
 * model reading it is an admissions tool with tone rules, not a counselor.
 */
export const DEVELOPMENT_MAX = 600;

export const developmentInputSchema = z.object({
  body: z.string().trim().min(3).max(DEVELOPMENT_MAX),
  /** Set when this answers a specific commitment's question. */
  commitmentId: z.string().trim().min(1).nullable().optional(),
});

export type DevelopmentInput = z.infer<typeof developmentInputSchema>;
