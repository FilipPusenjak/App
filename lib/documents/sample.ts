// The locked preview free users see: a sample document for a student who does
// not exist.
//
// SYNTHETIC BY CONSTRUCTION. This module takes no arguments and imports
// nothing that can reach the database or a session, so the preview cannot
// contain the viewer's own data however a page uses it — the guarantee is in
// the module's shape, and a test pins it.

export const SAMPLE_STUDENT = "Jordan Rivera";

export const SAMPLE_COMMON_APP = [
  {
    type: "Science/Math",
    position: "Captain",
    organization: "Lakeview High Science Olympiad",
    description: "Built and tested trebuchets and bridges for 3 events; ran Tuesday build sessions for 12 members; 2nd at regionals in Bridge Building",
    grades: "10, 11, 12",
    hours: "4",
    weeks: "30",
  },
  {
    type: "Community Service (Volunteer)",
    position: "",
    organization: "Riverside Public Library",
    description: "Tutor grades 3–5 in reading every Saturday; made flashcard sets used by 2 other tutors",
    grades: "9, 10, 11, 12",
    hours: "3",
    weeks: "40",
  },
  {
    type: "Work (Paid)",
    position: "Cashier",
    organization: "Corner Bakery",
    description: "Weekend shifts; opening register; trained 2 new hires on closing checklist",
    grades: "11, 12",
    hours: "10",
    weeks: "48",
  },
] as const;

export const SAMPLE_BRAG_SECTIONS = [
  { title: "Activities", lines: ["Science Olympiad — Captain, grades 10–12", "Library reading tutor — grades 9–12"] },
  { title: "Academic highlights", lines: ["AP Chemistry, AP Calculus AB", "Physics research project, spring"] },
  { title: "In my own words", lines: ["“The week our bridge snapped in testing, we rebuilt it in two days…”"] },
] as const;

export const SAMPLE_RESUME_LINES = [
  "JORDAN RIVERA",
  "EDUCATION — Lakeview High School, expected 2027",
  "ACTIVITIES — Science Olympiad, Captain · Library reading tutor · Corner Bakery",
  "HONORS — 2nd place, Regional Science Olympiad (Bridge Building)",
] as const;
