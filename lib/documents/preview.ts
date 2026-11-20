// The locked preview, assembled from the synthetic sample and nothing else.
// Kept apart from page-data.ts (which reads the session) so that what a free
// account is shown can be checked without one.
import {
  SAMPLE_BRAG_SECTIONS,
  SAMPLE_COMMON_APP,
  SAMPLE_RESUME_LINES,
  SAMPLE_STUDENT,
} from "./sample";

export type LockedPreview = {
  student: string;
  commonApp: typeof SAMPLE_COMMON_APP;
  bragSheet: typeof SAMPLE_BRAG_SECTIONS;
  resume: typeof SAMPLE_RESUME_LINES;
};

/** The preview. Takes no input by design. */
export function lockedPreview(): LockedPreview {
  return {
    student: SAMPLE_STUDENT,
    commonApp: SAMPLE_COMMON_APP,
    bragSheet: SAMPLE_BRAG_SECTIONS,
    resume: SAMPLE_RESUME_LINES,
  };
}
