// The CourseChart mark: a sextant.
//
// The name reads two ways and this is the better one. A chart is a graph, but a
// CHART is also what a navigator plots a course on, and charting a course is
// what this product does for a student — it gives a heading, not a dashboard.
// A sextant is the instrument that makes that possible: you point it at
// something fixed and far away, and it tells you where you actually are. That
// is the whole product in one object.
//
// ONE definition, rendered at two sizes — the browser-tab icon (app/icon.tsx)
// and the iOS home-screen icon (app/apple-icon.tsx). They were going to be two
// copies of the same geometry, and two copies of a logo drift: somebody nudges
// the tab icon, nobody thinks about the touch icon, and the phone keeps showing
// last year's mark.
//
// SIXTEEN OTHER MARKS WERE DRAWN AND REJECTED, most of them for reasons only
// visible at small sizes: a ship's wheel whose ring and spokes merge into a
// blob, a compass needle that goes muddy the moment it is two-tone, a
// four-point compass star that is legible but now reads as the AI sparkle every
// product has, a plotted course line indistinguishable at 16px from a line
// chart, an anchor that is perfectly crisp and means "moored", and a series of
// increasingly detailed sloops.
//
// THE SEXTANT IS A DELIBERATE TRADE. It is the least legible of the finalists
// at 16 pixels and the most distinctive at every size above that. It was chosen
// knowing that, which is why the tab icon is rendered at 64 rather than 32 —
// see app/icon.tsx for why that particular number.
//
// The geometry is an SVG on a 32-unit viewBox, so it scales by setting the
// canvas rather than by multiplying every number: one source of truth for the
// shape at any size.
//
// The gradient runs from a bright blue into the navy the interface already uses
// (zinc-900, #152a4d, defined in app/globals.css). Bright at the top left is
// what keeps it visible against both light and dark browser chrome; a flat navy
// square disappeared into a dark tab strip.

/** The design canvas. Every coordinate below is in these units. */
const VIEW = 32;
const CORNER_RADIUS = 7;

export const MARK_GRADIENT =
  "linear-gradient(135deg, #4a84e0 0%, #24427a 58%, #152a4d 100%)";

const WHITE = "#ffffff";

// The limb — the graduated arc a sextant is named for, since it spans a sixth
// of a circle. Drawn as an SVG arc, and its centre and radius are stated here
// rather than left implicit in the path, because the graduation marks below are
// radii of this exact circle. Deriving them keeps the ticks on the arc when the
// arc moves; eyeballing them did not.
const LIMB_CX = 16;
const LIMB_CY = 16.33;
const LIMB_R = 12.8;
const LIMB_STROKE = 3.2;
/** The arc itself, built from the radius above rather than repeating it. */
const LIMB_PATH = `M3.8 20.2 A ${LIMB_R} ${LIMB_R} 0 0 0 28.2 20.2`;
/** Where the graduations start and stop: just inside the limb's inner edge. */
const TICK_INNER = LIMB_R - LIMB_STROKE;
const TICK_OUTER = LIMB_R - LIMB_STROKE / 2 + 0.1;

/** One graduation, as a radius of the limb between two distances from centre. */
function graduation(degrees: number, from: number, to: number) {
  const radians = (degrees * Math.PI) / 180;
  const at = (r: number) =>
    `${(LIMB_CX + r * Math.cos(radians)).toFixed(2)} ${(
      LIMB_CY +
      r * Math.sin(radians)
    ).toFixed(2)}`;

  return (
    <path
      key={`tick-${degrees}`}
      d={`M${at(from)} L${at(to)}`}
      stroke={WHITE}
      strokeWidth="0.9"
      strokeLinecap="round"
      opacity="0.85"
    />
  );
}

// Satori cannot stringify a React fragment inside <svg>, so the shapes are an
// array of keyed elements rather than siblings in a fragment. It reports that
// only as "Cannot convert a Symbol value to a string", which is a confusing way
// to find out.
const SEXTANT = [
  <path
    key="limb"
    d={LIMB_PATH}
    fill="none"
    stroke={WHITE}
    strokeWidth={LIMB_STROKE}
    strokeLinecap="round"
  />,
  /** The frame: two legs from the pivot down to the ends of the limb. */
  <path
    key="frame"
    d="M16 4 L5.6 22.6 M16 4 L26.4 22.6"
    fill="none"
    stroke={WHITE}
    strokeWidth="2.3"
    strokeLinecap="round"
  />,
  /** The index arm, swinging from the pivot across the graduations. */
  <path
    key="arm"
    d="M16 4 L22 25.8"
    fill="none"
    stroke={WHITE}
    strokeWidth="1.7"
    strokeLinecap="round"
    opacity="0.62"
  />,
  /** The index mirror sits at the pivot the arm turns on. */
  <circle key="pivot" cx="16" cy="4.2" r="1.9" fill={WHITE} />,
  /** The telescope, sighted on the horizon. */
  <rect key="scope" x="4.6" y="8.6" width="9" height="2.8" rx="1.4" fill={WHITE} />,
  <rect
    key="lens"
    x="3.2"
    y="7.8"
    width="1.9"
    height="4.4"
    rx="0.95"
    fill={WHITE}
    opacity="0.8"
  />,
  // Five graduations, stopping just inside the limb's inner edge — both
  // distances derived from the arc above, so nudging the limb moves them with
  // it rather than leaving them floating in the gap.
  ...[52, 71, 90, 109, 128].map((degrees) =>
    graduation(degrees, TICK_INNER, TICK_OUTER),
  ),
];

/**
 * The mark, at whatever pixel size the caller needs.
 *
 * `rounded` is false for the iOS icon: the system applies its own corner mask,
 * and a rounded square inside that mask shows the page colour in the corners.
 */
export function CourseMark({
  size = VIEW,
  rounded = true,
}: {
  size?: number;
  rounded?: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: MARK_GRADIENT,
        borderRadius: rounded ? Math.round((CORNER_RADIUS * size) / VIEW) : 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        {SEXTANT}
      </svg>
    </div>
  );
}
