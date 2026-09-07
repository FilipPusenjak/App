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
// as making way rather than moored, and the jib is held at 0.6 rather than half
// opacity because below that it washes out against dark browser chrome.
//
// The rig is drawn rather than implied: a mast, a boom, sails whose leeches
// curve as wind fills them, and a hull with a sheer line instead of a flat
// wedge. That detail is spent where it survives the downscale — silhouette and
// contrast — rather than on rigging lines, a masthead pennant or a waterline,
// each of which was drawn, rendered at 16px, and turned out to be a smudge.
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
// array of keyed elements rather than siblings in a fragment. It reports that
// only as "Cannot convert a Symbol value to a string", which is a confusing
// way to find out.
const SLOOP = [
  /** Mainsail, aft of the mast, its leech curved as wind fills it. */
  <path
    key="main"
    d="M17.8 4.2 L17.8 20.2 L27.4 20.2 C23.6 14.4 21 9 17.8 4.2 Z"
    fill="#ffffff"
  />,
  /** Jib, forward of the mast and smaller, as a sloop's headsail is. */
  <path
    key="jib"
    d="M15.4 7.4 L15.4 20.2 L7 20.2 C10.6 15.6 13.2 11.4 15.4 7.4 Z"
    fill="#ffffff"
    opacity="0.6"
  />,
  <rect key="mast" x="16.1" y="3" width="1.1" height="18.6" rx="0.5" fill="#ffffff" />,
  <rect key="boom" x="16.4" y="20.4" width="10.6" height="1.1" rx="0.5" fill="#ffffff" />,
  /** Hull, with a sheer line rather than a flat wedge. */
  <path
    key="hull"
    d="M4.6 23.2 h22.8 c-1.1 3.3 -3.9 5.2 -7.4 5.2 h-8 c-3.5 0 -6.3 -1.9 -7.4 -5.2 z"
    fill="#ffffff"
  />,
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
        {SLOOP}
      </svg>
    </div>
  );
}
