import mammoth from "mammoth";
import { countWords } from "./words";
import { TYPES, containerTitle, type ProjectType } from "./types";
import { escapeText, fromMarkdown, toPlain } from "./format";

// Imports bring in the writer's own existing work (Word, Google Docs, plain
// text). Nothing here generates or alters text beyond splitting it into
// chapters and scenes at the writer's own headings and scene breaks.

export type Block = { t: "title" | "h1" | "h2" | "h3" | "p" | "break"; text: string };

const BREAK_RE = /^\s*(?:(?:\*\s*){3,}|(?:#\s*){1,3}|(?:-\s*){3,}|(?:~\s*){3,}|(?:•\s*){3,}|(?:_\s*){3,}|§)\s*$/;
export const SCENE_BREAK = "\\* \\* \\*"; // "* * *" in stored format
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export class ImportError extends Error {}

function entities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// HTML from mammoth → our stored format, keeping bold and italics.
function decode(html: string): string {
  let out = "";
  let b = 0, i = 0;
  const re = /<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) { out += escapeText(entities(m[3])); continue; }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") out += "\n";
    else if (tag === "strong" || tag === "b") {
      if (!close && b++ === 0) out += "**";
      else if (close && b > 0 && --b === 0) out += "**";
    } else if (tag === "em" || tag === "i") {
      if (!close && i++ === 0) out += "_";
      else if (close && i > 0 && --i === 0) out += "_";
    }
  }
  if (b > 0) out += "**";
  if (i > 0) out += "_";
  // Drop empty marks, then trailing spaces before line breaks.
  return out.replace(/(?<!\\)\*\*\*\*/g, "").replace(/(?<!\\)__/g, "").replace(/[ \t ]+\n/g, "\n").trim();
}

// text is in stored format (escaped, with marks).
function pushPara(blocks: Block[], text: string) {
  const plain = toPlain(text);
  if (!plain.trim()) return;
  if (BREAK_RE.test(plain)) blocks.push({ t: "break", text: "" });
  else blocks.push({ t: "p", text });
}

export async function parseDocx(buf: Buffer): Promise<{ blocks: Block[]; title: string | null }> {
  if (buf.length > MAX_IMPORT_BYTES) throw new ImportError("That file is too big (20 MB at most).");
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportError("That doesn't look like a Word (.docx) file. Old .doc files need to be saved as .docx first.");
  let html: string;
  try {
    const r = await mammoth.convertToHtml(
      { buffer: buf },
      {
        styleMap: [
          "p[style-name='Title'] => h6.doctitle:fresh",
          "p[style-name='Subtitle'] => p:fresh",
        ],
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    html = r.value;
  } catch {
    throw new ImportError("We couldn't read that Word file.");
  }
  const blocks: Block[] = [];
  let title: string | null = null;
  // mammoth emits flat block-level elements; lists come through as <ul>/<ol>.
  const re = /<(h[1-6]|p|li|td)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const text = decode(m[2]);
    const plainText = toPlain(text).trim();
    if (tag === "h6" && /doctitle/.test(m[0].slice(0, 40))) {
      if (!title && plainText) title = plainText;
      else pushPara(blocks, text);
      continue;
    }
    if (/^h[1-5]$/.test(tag)) {
      if (!plainText) continue;
      const level = Math.min(3, Number(tag[1]));
      blocks.push({ t: (`h${level}` as Block["t"]), text: plainText });
    } else {
      pushPara(blocks, tag === "li" ? "• " + text : text);
    }
  }
  return { blocks, title };
}

export function parseText(text: string, markdown: boolean): { blocks: Block[]; title: string | null } {
  const blocks: Block[] = [];
  const fmt = (t: string) => (markdown ? fromMarkdown(t) : escapeText(t));
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const raw of paras) {
    const para = raw.replace(/\s+$/g, "");
    if (!para.trim()) continue;
    if (markdown) {
      const lines = para.split("\n");
      let buf: string[] = [];
      for (const line of lines) {
        const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (h) {
          if (buf.length) { pushPara(blocks, fmt(buf.join("\n"))); buf = []; }
          blocks.push({ t: (`h${Math.min(3, h[1].length)}` as Block["t"]), text: toPlain(fromMarkdown(h[2])) });
        } else buf.push(line);
      }
      if (buf.length) pushPara(blocks, fmt(buf.join("\n")));
    } else {
      pushPara(blocks, fmt(para));
    }
  }
  return { blocks, title: null };
}

// Google Docs: a link to a doc shared "Anyone with the link". We only ever
// fetch from Google's own export URL built from the document id.
export function googleDocId(url: string): { id: string; kind: "doc" | "drive" } | null {
  const doc = url.match(/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/);
  if (doc) return { id: doc[1], kind: "doc" };
  const drive = url.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{20,})/);
  if (drive) return { id: drive[1], kind: "drive" };
  return null;
}

export async function fetchGoogle(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const g = googleDocId(url.trim());
  if (!g) throw new ImportError("That isn't a Google Docs link. It should start with https://docs.google.com/document/d/…");
  const target = g.kind === "doc"
    ? `https://docs.google.com/document/d/${g.id}/export?format=docx`
    : `https://drive.google.com/uc?export=download&id=${g.id}`;
  let res: Response;
  try {
    res = await fetcher(target, { redirect: "follow", signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new ImportError("Google didn't answer. Try again in a moment, or download the doc as Word and upload that.");
  }
  const notShared = "We couldn't open that doc. In Google Docs, click Share and set General access to “Anyone with the link”, then try again — or use File → Download → Microsoft Word and upload the file here.";
  if (!res.ok) throw new ImportError(notShared);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_IMPORT_BYTES) throw new ImportError("That doc is too big (20 MB at most).");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMPORT_BYTES) throw new ImportError("That doc is too big (20 MB at most).");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportError(notShared);
  return buf;
}

// ---------- turning blocks into a project ----------------------------------

export type Scene = { title: string; body: string };
export type Container = { title: string; scenes: Scene[] };
export type Plan = { containers: Container[] | null; scenes: Scene[] | null; page: string | null };

function joinParas(paras: string[], poem: boolean) {
  if (!poem) return paras.join("\n\n");
  // Poems: when each paragraph is a single short line, keep them as lines.
  const short = paras.length > 1 && paras.filter((p) => !p.includes("\n") && p.length <= 80).length / paras.length > 0.7;
  return paras.join(short ? "\n" : "\n\n");
}

export function suggestType(blocks: Block[]): ProjectType {
  const levels = new Set(blocks.filter((b) => b.t.startsWith("h")).map((b) => b.t));
  if (levels.size >= 1) return "novel";
  if (blocks.some((b) => b.t === "break")) return "short_story";
  return "freeform";
}

export function planImport(type: ProjectType, blocks: Block[]): Plan {
  const def = TYPES[type];
  if (def.single) {
    const parts: string[] = [];
    for (const b of blocks) {
      if (b.t === "break") parts.push(SCENE_BREAK);
      else if (b.t === "title") continue;
      else parts.push(b.text);
    }
    return { containers: null, scenes: null, page: joinParas(parts, type === "poem") };
  }

  const headingLevels = [...new Set(blocks.filter((b) => /^h\d$/.test(b.t)).map((b) => b.t))].sort();
  const top = headingLevels[0] ?? null;
  const second = headingLevels[1] ?? null;

  // Split a run of blocks into scenes at scene headings and scene breaks.
  const toScenes = (run: Block[], sceneHeading: string | null, startAt = 1): Scene[] => {
    const scenes: Scene[] = [];
    let title: string | null = null;
    let paras: string[] = [];
    const flush = () => {
      if (!paras.length && title === null) return;
      scenes.push({ title: title ?? `Scene ${startAt + scenes.length}`, body: paras.join("\n\n") });
      title = null;
      paras = [];
    };
    for (const b of run) {
      if (sceneHeading && b.t === sceneHeading) { flush(); title = b.text; }
      else if (b.t === "break") flush();
      else if (b.t.startsWith("h")) { flush(); title = b.text; } // deeper headings start a scene too
      else paras.push(b.text);
    }
    flush();
    return scenes;
  };

  if (!def.container) {
    // Short story: every heading or break starts a new scene.
    const scenes = toScenes(blocks.filter((b) => b.t !== "title"), top);
    return { containers: null, scenes: scenes.length ? scenes : [{ title: "Scene 1", body: "" }], page: null };
  }

  const containers: Container[] = [];
  let current: { title: string; run: Block[] } | null = null;
  const before: Block[] = [];
  for (const b of blocks) {
    if (b.t === "title") continue;
    if (top && b.t === top) {
      if (current) containers.push({ title: current.title, scenes: toScenes(current.run, second) });
      current = { title: b.text, run: [] };
    } else if (current) current.run.push(b);
    else before.push(b);
  }
  if (current) containers.push({ title: current.title, scenes: toScenes(current.run, second) });
  if (before.some((b) => b.t !== "break")) {
    const scenes = toScenes(before, second);
    containers.unshift({ title: containers.length ? "Opening" : containerTitle(def.container, 1), scenes });
  }
  if (!containers.length) containers.push({ title: containerTitle(def.container, 1), scenes: [] });
  for (const c of containers) if (!c.scenes.length) c.scenes.push({ title: "Scene 1", body: "" });
  return { containers, scenes: null, page: null };
}

export function summarize(plan: Plan) {
  const words = (s: string) => countWords(s);
  if (plan.page !== null) return { kind: "page", words: words(plan.page) };
  if (plan.scenes) return { kind: "scenes", scenes: plan.scenes.map((s) => ({ title: s.title, words: words(s.body) })), words: plan.scenes.reduce((a, s) => a + words(s.body), 0) };
  const cs = plan.containers!.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => ({ title: s.title, words: words(s.body) })) }));
  return { kind: "containers", containers: cs, words: cs.reduce((a, c) => a + c.scenes.reduce((b, s) => b + s.words, 0), 0) };
}

export function validateBlocks(input: unknown): Block[] {
  if (!Array.isArray(input) || input.length > 50_000) throw new ImportError("Nothing to import.");
  const ok = new Set(["title", "h1", "h2", "h3", "p", "break"]);
  let total = 0;
  return input.map((b: any) => {
    if (!b || !ok.has(b.t) || typeof (b.text ?? "") !== "string") throw new ImportError("Nothing to import.");
    total += (b.text ?? "").length;
    if (total > 5_000_000) throw new ImportError("That document is too long to import in one go.");
    return { t: b.t, text: b.text ?? "" };
  });
}
