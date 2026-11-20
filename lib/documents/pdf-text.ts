// Plain-text PDF layout shared by the resume and the brag sheet.
//
// One column of real text in the standard Helvetica faces: what an
// applicant-tracking system or a recommender's screen reader reads reliably.
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

export const PAGE = { width: 612, height: 792 }; // US Letter
export const MARGIN = 54;
/** The floor. Nothing in any generated document is set smaller. */
export const BODY = 10;
export const LINE = 13;
export const HEADING = 11;
export const TITLE = 16;

export type Fonts = { regular: PDFFont; bold: PDFFont };
export type Line = { text: string; font: "regular" | "bold"; size: number; indent: number };
export type Block = { lines: Line[]; spaceBefore: number };

/**
 * The standard fonts only encode Windows-1252. Anything outside it — an emoji,
 * a non-Latin name — is replaced with "?" rather than crashing the export, and
 * the caller is told so it can tell the student.
 */
export function sanitizeForPdf(text: string, font: PDFFont): { text: string; replaced: boolean } {
  let replaced = false;
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      replaced = true;
      out += "?";
    }
  }
  return { text: out, replaced };
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Builds blocks of wrapped, sanitized lines. Records whether anything was replaced. */
export function blockBuilder(fonts: Fonts) {
  const width = PAGE.width - MARGIN * 2;
  const state = { replaced: false };
  const para = (text: string, font: "regular" | "bold", size: number, indent = 0): Line[] => {
    const f = font === "bold" ? fonts.bold : fonts.regular;
    const s = sanitizeForPdf(text, f);
    if (s.replaced) state.replaced = true;
    return wrap(s.text, f, size, width - indent).map((l) => ({ text: l, font, size, indent }));
  };
  return { para, state };
}

export const lineAdvance = (l: Line) => (l.size > BODY ? l.size + 5 : LINE);

export function heightOf(blocks: Block[]): number {
  return blocks.reduce((h, b) => h + b.spaceBefore + b.lines.reduce((s, l) => s + lineAdvance(l), 0), 0);
}

export async function newDocument(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("CourseChart");
  doc.setProducer("CourseChart");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return { doc, fonts };
}

/**
 * Draw blocks top to bottom. With `maxPages: 1` anything past the page is not
 * drawn — callers that need one page must cut content BEFORE drawing (the
 * resume does), never rely on this.
 */
export function drawBlocks(doc: PDFDocument, fonts: Fonts, blocks: Block[], maxPages = Infinity) {
  let page = doc.addPage([PAGE.width, PAGE.height]);
  let pages = 1;
  let y = PAGE.height - MARGIN;
  outer: for (const block of blocks) {
    y -= block.spaceBefore;
    for (const line of block.lines) {
      const advance = lineAdvance(line);
      if (y - advance < MARGIN - 2) {
        if (pages >= maxPages) break outer;
        page = doc.addPage([PAGE.width, PAGE.height]);
        pages += 1;
        y = PAGE.height - MARGIN;
      }
      y -= advance;
      page.drawText(line.text, {
        x: MARGIN + line.indent,
        y: y + 3,
        size: line.size,
        font: line.font === "bold" ? fonts.bold : fonts.regular,
      });
    }
  }
  return pages;
}
