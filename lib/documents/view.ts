// What the Common App builder page shows, assembled from a draft and its
// snapshot. Pure, so the page stays thin and the shape is testable.
import {
  annualHours,
  detectGaps,
  hasDescribableContent,
  type Gap,
} from "./activities";
import { entryKey, type CommonAppEntryFields, type CommonAppFields } from "./fields";
import { COMMON_APP_LIMITS_PROVENANCE, type CommonAppLimits } from "./limits";
import type { HonorSource, SourceSnapshot } from "./store";

export type ActivityView = {
  id: string;
  title: string;
  org: string | null;
  positionTitle: string | null;
  commonAppType: string | null;
  gradeLevels: number[];
  timing: string | null;
  hoursPerWeek: number | null;
  weeksPerYear: number | null;
  annualHours: number | null;
  facts: string[];
  gaps: Gap[];
  /** One line, in profile terms, for why it sits where it was suggested. */
  reason: string;
  /** False when there is nothing to describe yet: no facts, description or evidence. */
  describable: boolean;
  entry: CommonAppEntryFields;
  edited: { position: boolean; organization: boolean; description: boolean };
};

export type CommonAppView = {
  cycle: string;
  limits: CommonAppLimits;
  honorsLimitsConfirmed: boolean;
  /** The list as it stands: confirmed, or the current suggestion. */
  order: string[];
  suggestedOrder: string[];
  orderConfirmed: boolean;
  activities: Record<string, ActivityView>;
  /** Every listable activity that is not on the list, best-scored first. */
  notOnList: string[];
  honors: HonorSource[];
  awards: SourceSnapshot["awards"];
};

const EMPTY_ENTRY: CommonAppEntryFields = {
  position: "",
  organization: "",
  description: "",
  descriptionStatus: "empty",
  descriptionSourceHash: null,
  flag: null,
};

export function commonAppView(input: {
  fields: CommonAppFields;
  snapshot: SourceSnapshot;
  editedFieldKeys: string[];
  orderConfirmed: boolean;
}): CommonAppView {
  const { fields, snapshot } = input;
  const edited = new Set(input.editedFieldKeys);
  const activities: Record<string, ActivityView> = {};
  for (const a of snapshot.activities) {
    activities[a.id] = {
      id: a.id,
      title: a.title,
      org: a.org,
      positionTitle: a.positionTitle,
      commonAppType: a.commonAppType,
      gradeLevels: a.gradeLevels,
      timing: a.timing,
      hoursPerWeek: a.hoursPerWeek,
      weeksPerYear: a.weeksPerYear,
      annualHours: annualHours(a),
      facts: a.facts,
      gaps: detectGaps(a),
      reason: fields.suggestion.reasons[a.id] ?? "",
      describable: hasDescribableContent(a),
      entry: fields.entries[a.id] ?? EMPTY_ENTRY,
      edited: {
        position: edited.has(entryKey(a.id, "position")),
        organization: edited.has(entryKey(a.id, "organization")),
        description: edited.has(entryKey(a.id, "description")),
      },
    };
  }
  const onList = new Set(fields.order);
  // Best-scored first: the suggestion's order, then whatever it left out.
  const ranked = [...fields.suggestion.order, ...fields.suggestion.notSelected];
  return {
    cycle: snapshot.cycle,
    limits: snapshot.limits,
    honorsLimitsConfirmed: COMMON_APP_LIMITS_PROVENANCE[snapshot.cycle]?.honorsConfirmed ?? false,
    order: fields.order.filter((id) => activities[id]),
    suggestedOrder: fields.suggestion.order,
    orderConfirmed: input.orderConfirmed,
    activities,
    notOnList: ranked.filter((id) => activities[id] && !onList.has(id)),
    honors: snapshot.honors,
    awards: snapshot.awards,
  };
}
