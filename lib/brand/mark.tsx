// The CourseChart mark: a sloop under sail, on a blue field.
//
// The name reads two ways and this is the better one. A chart is a graph, but a
// CHART is also the thing a navigator plots a course on, and "charting your
// course" is what the product actually does for a student — it is not a
// dashboard, it is a heading. The first mark was three ascending bars, which
// was the dull reading of the name and looked like every analytics tool.
//
// ONE definition, rendered at two sizes — the browser-tab icon (app/icon.tsx)
// and the iOS home-screen icon (app/apple-icon.tsx). They were going to be two
// copies of the same geometry, and two copies of a logo drift: somebody nudges
// the tab icon, nobody thinks about the touch icon, and the phone keeps showing
// last year's mark.
//
// DESIGNED FOR 16 PIXELS, and chosen there rather than at 32. A favicon renders
// in a tab strip at half this canvas, beside a dozen others, and that is the
// only size at which it truly has to work. Six maritime candidates were drawn
// and rendered at 16px on both light and dark chrome before this one was
// picked. What the small size ruled out is most of what it ruled out:
//
//   - a ship's wheel, whose ring and spokes merge into a blob;
//   - a compass needle, which goes muddy the moment it is two-tone;
//   - a four-point compass star, which is legible but now reads as the AI
//     sparkle every product has, not as navigation;
//   - a plotted course line, which at 16px is indistinguishable from the line
//     chart this mark exists to get away from;
//   - sails with no hull, which read as two mountains.
//
// A hull with a main and a jib survives it. The boat leans right, which reads
// as making way rather than moored, and the jib is held at 0.62 rather than
// half opacity because below that it washes out against dark browser chrome.
//
// The geometry is an SVG on a 32-unit viewBox, so it scales by setting the
// canvas rather than by multiplying every number — one source of truth for the
// shape at any size.
//
// The gradient runs from a bright blue into the navy the interface already uses
// (zinc-900, #152a4d, defined in app/globals.css). Bright at the top left is
// what keeps it visible against both light and dark chrome; a flat navy square
// disappeared into a dark tab strip.

/** The design canvas. Every coordinate below is in these units. */
const VIEW = 32;
const CORNER_RADIUS = 7;

export const MARK_GRADIENT =
  "linear-gradient(135deg, #4a84e0 0%, #24427a 58%, #152a4d 100%)";

// Satori cannot stringify a React fragment inside <svg>, so the shapes are an
// array of keyed elements rather than siblings in a fragment.
const SAIL = [
  /** Mainsail, aft of the mast. */
  <polygon key="main" points="17.5,2.5 17.5,20.5 28.5,20.5" fill="#ffffff" />,
  /** Jib, forward of it and smaller, as a sloop's headsail is. */
  <polygon key="jib" points="15,8 15,20.5 6,20.5" fill="#ffffff" opacity="0.62" />,
  /** Hull, a shallow wedge with the transom square and the bow drawn in. */
  <path key="hull" d="M5.5 23.5 h21.5 l-4 5 h-13.5 z" fill="#ffffff" />,
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
        {SAIL}
      </svg>
    </div>
  );
}
