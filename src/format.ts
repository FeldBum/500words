// Writing is stored as plain lines with two inline marks, a small subset of
// Markdown:  **bold**  and  _italic_ .  Literal \ * _ are escaped with a
// backslash. public/app.js carries an identical copy of parseLine.

export type Run = { text: string; b: boolean; i: boolean };

export function escapeText(s: string): string {
  return s.replace(/[\\*_]/g, (c) => "\\" + c);
}

// Parse a whole body into lines of runs. Bold/italic may span lines.
export function parseBody(body: string): Run[][] {
  const lines: Run[][] = [];
  let b = false, i = false;
  for (const line of body.split("\n")) {
    const runs: Run[] = [];
    let buf = "";
    const flush = () => { if (buf) { runs.push({ text: buf, b, i }); buf = ""; } };
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (c === "\\" && k + 1 < line.length && "\\*_".includes(line[k + 1])) { buf += line[++k]; continue; }
      if (c === "*" && line[k + 1] === "*") { flush(); b = !b; k++; continue; }
      if (c === "_") { flush(); i = !i; continue; }
      buf += c;
    }
    flush();
    lines.push(runs);
  }
  return lines;
}

export function toPlain(body: string): string {
  return parseBody(body).map((runs) => runs.map((r) => r.text).join("")).join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function runsToHtml(runs: Run[]): string {
  return runs.map((r) => {
    let t = esc(r.text);
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return t;
  }).join("");
}

export const BREAK_LINE = /^\s*(?:(?:\*\s*){3,}|(?:#\s*){1,3}|(?:-\s*){3,}|(?:~\s*){3,}|(?:•\s*){3,}|§)\s*$/;

// Escape text written before formatting existed (or plain imports).
export function legacyEscape(s: string): string {
  return escapeText(s);
}

// Convert ordinary Markdown emphasis to ours: *x* or _x_ → italic, **x** / __x__ → bold.
export function fromMarkdown(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (BREAK_LINE.test(line)) { out.push(line.trim().replace(/\*/g, "\\*")); continue; }
    // Tokenize emphasis first, escape everything else.
    let res = "";
    let k = 0;
    while (k < line.length) {
      const rest = line.slice(k);
      let m = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/);
      if (m) { res += "**" + escapeText(m[2].replace(/(\*|_)(?=\S)([^*_]*?\S)\1/g, "$2")) + "**"; k += m[0].length; continue; }
      m = rest.match(/^(\*|_)(?=\S)([^*_]*?\S)\1(?![\p{L}\p{N}])/u);
      if (m && !(m[1] === "_" && k > 0 && /[\p{L}\p{N}]/u.test(line[k - 1]))) { res += "_" + escapeText(m[2]) + "_"; k += m[0].length; continue; }
      if (line[k] === "\\" && k + 1 < line.length && /[\\*_`#]/.test(line[k + 1])) { res += escapeText(line[k + 1]); k += 2; continue; }
      res += escapeText(line[k]);
      k++;
    }
    out.push(res);
  }
  return out.join("\n");
}
