import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { parseBody, toPlain, BREAK_LINE } from "./format";

export type Part = { title: string; container: string | null; containerId: number | null; body: string };

export async function buildDocx(opts: {
  title: string;
  author: string;
  type: string;
  parts: Part[];
  titles: boolean;
  breaks: boolean;
  hasContainers: boolean;
  single: boolean;
}): Promise<Buffer> {
  const mono = opts.type === "script";
  const poem = opts.type === "poem";
  const font = mono ? "Courier New" : "Georgia";
  const size = 24; // half-points: 12 pt
  const children: Paragraph[] = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: opts.title, font })] }));
  if (opts.author) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: `by ${opts.author}`, font, size, italics: true })] }));

  const breakPara = () => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun({ text: "* * *", font, size })] });

  let lastContainer: number | null | undefined = undefined;
  let firstContainer = true;
  opts.parts.forEach((p, idx) => {
    const newContainer = opts.hasContainers && p.containerId !== lastContainer;
    if (newContainer) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, pageBreakBefore: !firstContainer, spacing: { before: 240, after: 240 }, children: [new TextRun({ text: p.container || "", font })] }));
      firstContainer = false;
      lastContainer = p.containerId;
    } else if (idx > 0 && opts.breaks && !opts.single) {
      children.push(breakPara());
    }
    if (opts.titles && !opts.single && p.title) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: p.title, font })] }));
    }
    const lines = parseBody(p.body.replace(/^\n+|\n+$/g, ""));
    for (const runs of lines) {
      const plain = runs.map((r) => r.text).join("");
      if (!plain.trim()) {
        if (poem || mono) children.push(new Paragraph({ children: [] }));
        continue;
      }
      if (BREAK_LINE.test(plain)) { children.push(breakPara()); continue; }
      children.push(new Paragraph({
        spacing: { after: poem || mono ? 0 : 160, line: poem || mono ? 276 : 360 },
        children: runs.map((r) => new TextRun({ text: r.text, bold: r.b, italics: r.i, font, size })),
      }));
    }
  });

  const doc = new Document({
    creator: opts.author || "500words",
    title: opts.title,
    description: "Exported from 500words",
    styles: { default: { document: { run: { font, size } } } },
    sections: [{ properties: {}, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export function safeFilename(title: string) {
  return (title.replace(/[^\p{L}\p{N}\-' ]+/gu, "").trim().slice(0, 80) || "manuscript");
}

export { toPlain };
