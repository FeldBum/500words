export type ProjectType = "novel" | "memoir" | "short_story" | "personal_essay" | "article" | "poem" | "script" | "play" | "freeform";

export interface TypeDef {
  label: string;
  // Kind of container that holds scenes (null = scenes sit at the top level).
  container: "chapter" | "act" | null;
  // Single-page types have one "page" and nothing else on show.
  single: boolean;
  containerLabel?: string;
  // Single-page types that also keep a notes page (stored as the overview).
  notes?: boolean;
}

export const TYPES: Record<ProjectType, TypeDef> = {
  novel: { label: "Novel", container: "chapter", single: false, containerLabel: "Chapter" },
  memoir: { label: "Memoir", container: "chapter", single: false, containerLabel: "Chapter" },
  short_story: { label: "Short story", container: null, single: false },
  personal_essay: { label: "Personal essay", container: null, single: true, notes: true },
  article: { label: "Article / essay", container: null, single: true, notes: true },
  poem: { label: "Poem", container: null, single: true },
  script: { label: "Movie script", container: "act", single: false, containerLabel: "Act" },
  play: { label: "Play", container: "act", single: false, containerLabel: "Act" },
  freeform: { label: "Freeform", container: null, single: true },
};

export function isType(t: unknown): t is ProjectType {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(TYPES, t);
}

export const NODE_KINDS = ["overview", "character", "chapter", "act", "scene", "page"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

const ACT_NAMES = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export function containerTitle(kind: "chapter" | "act", n: number) {
  return kind === "chapter" ? `Chapter ${n}` : `Act ${ACT_NAMES[n - 1] ?? n}`;
}
