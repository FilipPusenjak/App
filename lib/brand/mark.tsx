// The CourseChart mark: three ascending bars on a blue field.
//
// ONE definition, rendered at two sizes — the browser-tab icon (app/icon.tsx)
// and the iOS home-screen icon (app/apple-icon.tsx). They were going to be two
// copies of the same geometry, and two copies of a logo drift: somebody nudges
// the tab icon, nobody thinks about the touch icon, and the phone keeps showing
// last year's mark.
//
// DESIGNED FOR 16 PIXELS. A favicon is rendered in a tab strip at half the 32px
// canvas, beside a dozen others, and that is the only size at which it truly
// has to work. Everything follows from that: three bars rather than a finer
// chart, gaps wide enough to survive downscaling, no text, no detail that turns
// to mush. It replaced a letter "A" that was legible but said nothing; a rising
// chart is the product's own shape, since the four-year progress chart is what
// a student actually comes back for.
//
// The gradient runs from a bright blue into the navy the interface already uses
// (zinc-900, #152a4d, defined in globals.css). Bright at the top left is what
// keeps it visible against both light and dark browser chrome — a flat navy
// square disappeared into a dark tab strip.

/** Bar heights at the 32px canvas, ascending in the proportion a chart would. */
const BARS = [10, 15, 21] as const;

/** Geometry at the 32px canvas; everything scales from it. */
const BAR_WIDTH = 5;
const BAR_GAP = 3;
const BAR_RADIUS = 2;
const BOTTOM_PADDING = 6;
const CORNER_RADIUS = 7;

export const MARK_GRADIENT =
  "linear-gradient(135deg, #4a84e0 0%, #24427a 58%, #152a4d 100%)";

/**
 * The mark, scaled from the 32px design.
 *
 * `rounded` is false for the iOS icon: the system applies its own mask, and a
 * rounded square inside that mask shows the page colour in the corners.
 */
export function ChartMark({
  scale = 1,
  rounded = true,
}: {
  scale?: number;
  rounded?: boolean;
}) {
  const px = (n: number) => Math.round(n * scale);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: px(BAR_GAP),
        paddingBottom: px(BOTTOM_PADDING),
        background: MARK_GRADIENT,
        borderRadius: rounded ? px(CORNER_RADIUS) : 0,
      }}
    >
      {BARS.map((height) => (
        <div
          key={height}
          style={{
            width: px(BAR_WIDTH),
            height: px(height),
            borderRadius: px(BAR_RADIUS),
            background: "#ffffff",
          }}
        />
      ))}
    </div>
  );
}
