"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Field, Input } from "@/components/ui/form";

/**
 * The course field, offering the names we actually hold requirements for.
 *
 * Built on a native <datalist> rather than a custom dropdown, for one reason
 * that outranks the styling: IT DOES NOT TRAP THE STUDENT. Most targets are
 * courses nothing has been researched for, and a picker that only accepted
 * known values would make the app unusable for exactly the students whose
 * schools are not in the data yet. Free text always works; the suggestions are
 * a nudge toward the spelling that resolves.
 *
 * The nudge is worth a lot. A student typing "Computer Science" at Cambridge
 * misses a record stored as "Computer Science B.A. (Hons)/M.Eng." — not because
 * anything is missing, but because the two strings differ. Picking from this
 * list makes the match exact instead of approximate, which is why the fix lives
 * here rather than in a looser matcher.
 */
export function CoursePicker({
  defaultValue,
  error,
  universityName,
  country,
}: {
  defaultValue: string;
  error?: string;
  universityName: string;
  country: string;
}) {
  const listId = useId();
  const [courses, setCourses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState(defaultValue);
  // Tracks the latest request so a slow early response cannot overwrite a fast
  // later one — the university field changes on every keystroke.
  const requestRef = useRef(0);

  // Whether a lookup is even possible right now. Derived rather than stored:
  // clearing the list from inside the effect would be a setState in an effect
  // body, which cascades a render, and the answer is a pure function of the
  // two inputs anyway.
  const canLookUp = universityName.trim().length >= 3 && country.length === 2;

  useEffect(() => {
    const name = universityName.trim();
    if (!canLookUp) return;

    const id = ++requestRef.current;
    // Debounced: this fires while someone types a university name, and one
    // request per keystroke would be a query per keystroke on a shared table.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/course-options?name=${encodeURIComponent(name)}&country=${encodeURIComponent(country)}`,
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { courses?: unknown };
        if (id !== requestRef.current) return;
        setCourses(Array.isArray(data.courses) ? (data.courses as string[]) : []);
      } catch {
        // A failed lookup must not break the form. The field stays exactly as
        // useful as it was before this component existed.
        if (id === requestRef.current) setCourses([]);
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [universityName, country, canLookUp]);

  // Stale results from a previous university must not be offered under the new
  // one, so the list is gated on the current inputs rather than on what the
  // last fetch happened to return.
  const shown = canLookUp ? courses : [];
  const exact = shown.includes(value.trim());
  const hint = describeHint({
    total: shown.length,
    loading: loading && canLookUp,
    hasUniversity: canLookUp,
    typed: value.trim().length > 0,
    exact,
  });

  return (
    <Field label="Course / major" htmlFor="course" error={error} hint={hint}>
      <Input
        id="course"
        name="course"
        list={shown.length > 0 ? listId : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Computer Science"
        autoComplete="off"
      />
      {shown.length > 0 && (
        <datalist id={listId}>
          {shown.map((course) => (
            <option key={course} value={course} />
          ))}
        </datalist>
      )}
    </Field>
  );
}

/**
 * What to tell the student about this field right now.
 *
 * Deliberately never says a course is wrong. A course that is not on the list
 * is a perfectly normal thing to be applying to — it only means the evaluation
 * will say "check the official course page" for it, which is what it does for
 * most targets. The message says what picking a listed name BUYS, rather than
 * implying anything is missing from what they typed.
 */
export function describeHint(state: {
  total: number;
  loading: boolean;
  hasUniversity: boolean;
  typed: boolean;
  exact: boolean;
}): string {
  if (!state.hasUniversity) {
    return "Especially important for UK course-specific admissions.";
  }
  if (state.loading) return "Checking which courses we have requirements for…";
  if (state.total === 0) {
    return "No researched courses for this university yet — type it in and the evaluation will say to check the official course page.";
  }
  if (state.exact) {
    return "Matched — this evaluation will use the real published entry requirements.";
  }
  if (state.typed) {
    return `We have verified requirements for ${state.total} course${state.total === 1 ? "" : "s"} here. Pick one from the list to use them, or keep your own wording.`;
  }
  return `${state.total} course${state.total === 1 ? "" : "s"} at this university have verified entry requirements — start typing to see them.`;
}
