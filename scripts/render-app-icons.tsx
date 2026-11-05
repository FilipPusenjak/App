// Renders the native app's icon and splash sources from the brand mark, and
// the two images Google Play's listing needs on top of screenshots.
//
//   npx tsx scripts/render-app-icons.tsx && (cd mobile && npm run assets)
//
// Same rule as app/icon.tsx and app/apple-icon.tsx: one definition of the mark
// (lib/brand/mark.tsx), rendered at whatever size is asked for, so the phone's
// home screen cannot keep last year's logo. @capacitor/assets then cuts these
// sources into every size Xcode and Android Studio want.
//
// UNROUNDED, like the apple-icon: both stores apply their own mask, and a
// rounded square inside it leaves corners showing.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { CourseMark, MARK_GRADIENT, MarkGlyph } from "@/lib/brand/mark";

const OUT = join(process.cwd(), "mobile", "assets");
const STORE = join(process.cwd(), "mobile", "store");

async function render(
  name: string,
  el: React.ReactElement,
  w: number,
  h: number,
  dir = OUT,
) {
  const res = new ImageResponse(el, { width: w, height: h });
  writeFileSync(join(dir, name), Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${join(dir, name).replace(process.cwd() + "/", "")} (${w}x${h})`);
}

/** The mark centred on a plain field, for the launch screen. */
function splash(background: string, size: number) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
      }}
    >
      {/* A fixed box, because CourseMark fills whatever contains it. */}
      <div style={{ display: "flex", width: size, height: size }}>
        <CourseMark size={size} />
      </div>
    </div>
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await render("icon-only.png", <CourseMark size={1024} rounded={false} />, 1024, 1024);
  // Android adaptive icon: the launcher masks these two layers into its own
  // shape and may crop to the middle 66%, so the glyph sits inside that.
  await render(
    "icon-foreground.png",
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <MarkGlyph size={600} />
    </div>,
    1024,
    1024,
  );
  await render(
    "icon-background.png",
    <div style={{ width: "100%", height: "100%", display: "flex", background: MARK_GRADIENT }} />,
    1024,
    1024,
  );
  // 2732 is the largest launch screen either platform asks for; the mark sits
  // at about a fifth of it so it survives the crop to a phone's aspect ratio.
  await render("splash.png", splash("#ffffff", 560), 2732, 2732);
  await render("splash-dark.png", splash("#09090b", 560), 2732, 2732);

  // Google Play listing: a 512x512 icon (Play rounds it itself) and the
  // 1024x500 feature graphic shown at the top of the store page. Play crops
  // the graphic's edges on some surfaces, so everything sits well inside it.
  mkdirSync(STORE, { recursive: true });
  await render("play-icon-512.png", <CourseMark size={512} rounded={false} />, 512, 512, STORE);
  await render(
    "play-feature-graphic.png",
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 56,
        background: MARK_GRADIENT,
        color: "#ffffff",
      }}
    >
      <MarkGlyph size={260} />
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -1 }}>CourseChart</div>
        <div style={{ fontSize: 34, marginTop: 12, lineHeight: 1.25, opacity: 0.92 }}>
          An honest read on where you stand for university
        </div>
      </div>
    </div>,
    1024,
    500,
    STORE,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
