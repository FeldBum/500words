import { test, expect, beforeAll } from "bun:test";

process.env.DATABASE_URL ||= "postgres://postgres@localhost:5433/w500_test?host=/tmp";
const { sql, migrate } = await import("../src/db");
const { handle } = await import("../src/server");
const { countWords, streaks, dayIn } = await import("../src/words");

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public;");
  await migrate();
});

class Client {
  cookie = "";
  async req(method: string, path: string, body?: any) {
    const headers: Record<string, string> = { "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 200) };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await handle(new Request("http://localhost" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), null);
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: any = {}) => this.req("POST", p, b);
  put = (p: string, b: any) => this.req("PUT", p, b);
  del = (p: string) => this.req("DELETE", p);
}

async function user(name: string) {
  const c = new Client();
  const r = await c.post("/api/signup", { username: name, password: "correct horse", timezone: "America/New_York" });
  expect(r.status).toBe(201);
  return c;
}
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

test("word counting", () => {
  expect(countWords("")).toBe(0);
  expect(countWords("Hello, world!")).toBe(2);
  expect(countWords("It's a well-known fact — isn't it?")).toBe(6);
  expect(countWords("  \n\n * * * \n ")).toBe(0);
  expect(countWords("Café naïve 1999 über")).toBe(4);
});

test("streaks", () => {
  const m = new Map([["2026-11-20", 600], ["2026-11-21", 500], ["2026-11-22", 520], ["2026-11-23", 700], ["2026-11-10", 900]]);
  expect(streaks(m, "2026-11-24")).toEqual({ current: 4, longest: 4, daysMet: 5 });
  m.set("2026-11-24", 510);
  expect(streaks(m, "2026-11-24").current).toBe(5);
  expect(streaks(m, "2026-11-26").current).toBe(0);
});

test("auth: sign-up rules, login, wrong password, signed-out access", async () => {
  const c = new Client();
  expect((await c.post("/api/signup", { username: "A b", password: "longenough" })).status).toBe(400);
  expect((await c.post("/api/signup", { username: "shorty", password: "short" })).status).toBe(400);
  await user("ruth");
  expect((await new Client().post("/api/signup", { username: "Ruth", password: "whatever123" })).status).toBe(409);
  expect((await new Client().post("/api/login", { username: "ruth", password: "nope nope" })).status).toBe(401);
  const ok = new Client();
  expect((await ok.post("/api/login", { username: "RUTH", password: "correct horse" })).status).toBe(200);
  expect((await ok.get("/api/projects")).status).toBe(200);
  expect((await new Client().get("/api/projects")).status).toBe(401);
});

test("new projects get the right structure", async () => {
  const c = await user("structure");
  const shape = async (type: string) => {
    const p = (await c.post("/api/projects", { type, title: type })).data.project;
    const { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
    return nodes.map((n: any) => n.kind).sort().join(",");
  };
  expect(await shape("novel")).toBe("chapter,overview,scene");
  expect(await shape("short_story")).toBe("overview,scene");
  expect(await shape("play")).toBe("act,overview,scene");
  expect(await shape("script")).toBe("act,overview,scene");
  expect(await shape("poem")).toBe("page");
  expect(await shape("freeform")).toBe("page");
  expect((await c.post("/api/projects", { type: "essay" })).status).toBe(400);
});

test("daily count: net new words per node, pastes excluded, paste-then-delete costs nothing", async () => {
  const c = await user("counter");
  const p = (await c.post("/api/projects", { type: "short_story", title: "S" })).data.project;
  const { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  const scene = nodes.find((n: any) => n.kind === "scene");
  const overview = nodes.find((n: any) => n.kind === "overview");

  let r = await c.put(`/api/nodes/${scene.id}`, { body: words(120) });
  expect(r.data.todayWords).toBe(120);
  r = await c.put(`/api/nodes/${overview.id}`, { body: words(80) });
  expect(r.data.todayWords).toBe(200);
  // Paste 300 words: they're stored but don't count.
  r = await c.put(`/api/nodes/${scene.id}`, { body: words(420), pasted: 300 });
  expect(r.data.words).toBe(420);
  expect(r.data.todayWords).toBe(200);
  // Delete the pasted chunk, then type 50 more: those 50 count.
  r = await c.put(`/api/nodes/${scene.id}`, { body: words(120) });
  expect(r.data.todayWords).toBe(200);
  r = await c.put(`/api/nodes/${scene.id}`, { body: words(170) });
  expect(r.data.todayWords).toBe(250);
  // Deleting below the day's starting point never goes negative.
  r = await c.put(`/api/nodes/${scene.id}`, { body: "" });
  expect(r.data.todayWords).toBe(80);
  // Title/notes-only saves don't change the count; notes don't count.
  r = await c.put(`/api/nodes/${scene.id}`, { summary: words(400), title: "Renamed" });
  expect((await c.get("/api/stats")).data.todayWords).toBe(80);
});

test("words written yesterday don't count today; streak builds", async () => {
  const c = await user("yesterday");
  const me = (await c.get("/api/me")).data.user;
  const p = (await c.post("/api/projects", { type: "freeform", title: "F" })).data.project;
  const page = (await c.get(`/api/projects/${p.id}`)).data.nodes[0];
  const today = dayIn("America/New_York");
  const y = new Date(today + "T12:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  const yday = y.toISOString().slice(0, 10);
  // Pretend 600 words were written yesterday.
  await sql`update nodes set body = ${words(600)}, words = 600 where id = ${page.id}`;
  await sql`insert into node_days (user_id, node_id, day, baseline, current, pasted) values (${me.id}, ${page.id}, ${yday}::date, 0, 600, 0)`;
  let s = (await c.get("/api/stats")).data;
  expect(s.todayWords).toBe(0);
  expect(s.streak).toBe(1);
  const r = await c.put(`/api/nodes/${page.id}`, { body: words(1100) });
  expect(r.data.todayWords).toBe(500);
  s = (await c.get("/api/stats")).data;
  expect(s.streak).toBe(2);
  expect(s.totalWords).toBe(1100);
  expect(s.daysMet).toBe(2);
});

test("convert freeform → novel → play → short story → poem, keeping words and today's count", async () => {
  const c = await user("converter");
  const p = (await c.post("/api/projects", { type: "freeform", title: "Draft" })).data.project;
  const page = (await c.get(`/api/projects/${p.id}`)).data.nodes[0];
  await c.put(`/api/nodes/${page.id}`, { body: "Once upon a time there was a lamp." });
  const before = (await c.get("/api/stats")).data.todayWords;

  expect((await c.post(`/api/projects/${p.id}/convert`, { type: "novel" })).status).toBe(200);
  let { project, nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  expect(project.type).toBe("novel");
  const chapter = nodes.find((n: any) => n.kind === "chapter");
  const scene = nodes.find((n: any) => n.id === page.id);
  expect(scene.kind).toBe("scene");
  expect(scene.parentId).toBe(chapter.id);
  expect(nodes.some((n: any) => n.kind === "overview")).toBe(true);

  // Add a second chapter + scene, then a character.
  const ch2 = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "chapter" })).data.node;
  expect(ch2.title).toBe("Chapter 2");
  const s2 = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene", parentId: ch2.id })).data.node;
  await c.put(`/api/nodes/${s2.id}`, { body: "The lamp went out." });
  await c.post(`/api/projects/${p.id}/nodes`, { kind: "character", title: "Mira" });

  await c.post(`/api/projects/${p.id}/convert`, { type: "play" });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  expect(nodes.filter((n: any) => n.kind === "act").map((n: any) => n.title)).toEqual(["Chapter 1", "Chapter 2"]);
  expect(nodes.filter((n: any) => n.kind === "chapter").length).toBe(0);

  await c.post(`/api/projects/${p.id}/convert`, { type: "short_story" });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  const scenes = nodes.filter((n: any) => n.kind === "scene").sort((a: any, b: any) => a.position - b.position);
  expect(scenes.map((s: any) => s.id)).toEqual([page.id, s2.id]);
  expect(scenes.every((s: any) => s.parentId === null)).toBe(true);
  expect(nodes.some((n: any) => n.kind === "act")).toBe(false);

  const mid = (await c.get("/api/stats")).data.todayWords;
  await c.post(`/api/projects/${p.id}/convert`, { type: "poem" });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  const single = nodes.filter((n: any) => n.kind === "page");
  expect(single.length).toBe(1);
  const full = (await c.get(`/api/nodes/${single[0].id}`)).data.node;
  expect(full.body).toBe("Once upon a time there was a lamp.\n\n\\* \\* \\*\n\nThe lamp went out.");
  // Joining scenes isn't new writing: today's count is unchanged.
  expect((await c.get("/api/stats")).data.todayWords).toBe(mid);
  expect(mid).toBeGreaterThan(before);
  // Characters survive (hidden) and return when it becomes a novel again.
  await c.post(`/api/projects/${p.id}/convert`, { type: "novel" });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  expect(nodes.some((n: any) => n.kind === "character" && n.title === "Mira")).toBe(true);
  expect(nodes.filter((n: any) => n.kind === "overview").length).toBe(1);
});

test("moving scenes and chapters; scenes must live in a chapter", async () => {
  const c = await user("mover");
  const p = (await c.post("/api/projects", { type: "novel", title: "N" })).data.project;
  let { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  const ch1 = nodes.find((n: any) => n.kind === "chapter");
  const ch2 = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "chapter" })).data.node;
  expect((await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene" })).status).toBe(400);
  expect((await c.post(`/api/projects/${p.id}/nodes`, { kind: "act" })).status).toBe(400);
  const a = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene", parentId: ch2.id, title: "A" })).data.node;
  const b = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene", parentId: ch2.id, title: "B" })).data.node;
  await c.post(`/api/nodes/${b.id}/move`, { index: 0 });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  const order = nodes.filter((n: any) => n.parentId === ch2.id).sort((x: any, y: any) => x.position - y.position).map((n: any) => n.title);
  expect(order).toEqual(["B", "A"]);
  await c.post(`/api/nodes/${a.id}/move`, { parentId: ch1.id, index: 0 });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  expect(nodes.find((n: any) => n.id === a.id).parentId).toBe(ch1.id);
  // Manuscript order: chapter 1 (A, Scene 1), chapter 2 (B)
  const ms = (await c.get(`/api/projects/${p.id}/manuscript`)).data.parts.map((x: any) => x.title);
  expect(ms).toEqual(["A", "Scene 1", "B"]);
  // Move chapter 2 above chapter 1
  await c.post(`/api/nodes/${ch2.id}/move`, { index: 0 });
  const ms2 = (await c.get(`/api/projects/${p.id}/manuscript`)).data.parts.map((x: any) => x.title);
  expect(ms2).toEqual(["B", "A", "Scene 1"]);
  // Can't delete the last chapter
  await c.del(`/api/nodes/${ch2.id}`);
  expect((await c.del(`/api/nodes/${ch1.id}`)).status).toBe(400);
});

test("nobody can read or change someone else's writing", async () => {
  const a = await user("alice");
  const b = await user("bob");
  const p = (await a.post("/api/projects", { type: "freeform", title: "Secret" })).data.project;
  const page = (await a.get(`/api/projects/${p.id}`)).data.nodes[0];
  await a.put(`/api/nodes/${page.id}`, { body: "my secret diary" });
  expect((await b.get(`/api/projects/${p.id}`)).status).toBe(404);
  expect((await b.get(`/api/nodes/${page.id}`)).status).toBe(404);
  expect((await b.put(`/api/nodes/${page.id}`, { body: "hacked" })).status).toBe(404);
  expect((await b.del(`/api/projects/${p.id}`)).status).toBe(404);
  expect((await b.post(`/api/projects/${p.id}/convert`, { type: "novel" })).status).toBe(404);
  expect((await a.get(`/api/nodes/${page.id}`)).data.node.body).toBe("my secret diary");
  expect((await b.get("/api/projects")).data.projects.length).toBe(0);
});

test("friends see public stats only, never writing", async () => {
  const a = await user("writer_a");
  const b = await user("writer_b");
  const p = (await a.post("/api/projects", { type: "freeform", title: "x" })).data.project;
  const page = (await a.get(`/api/projects/${p.id}`)).data.nodes[0];
  await a.put(`/api/nodes/${page.id}`, { body: words(42) });
  expect((await b.post("/api/friends", { username: "@Writer_A" })).status).toBe(201);
  let f = (await b.get("/api/friends")).data;
  expect(f.friends[0].username).toBe("writer_a");
  expect(f.friends[0].stats).toBeNull();
  expect((await b.get("/api/writers/writer_a")).data.history).toBeNull();
  await a.put("/api/me", { isPublic: true });
  f = (await b.get("/api/friends")).data;
  expect(f.friends[0].stats.todayWords).toBe(42);
  const w = (await b.get("/api/writers/writer_a")).data;
  expect(w.following).toBe(true);
  expect(JSON.stringify(w)).not.toContain("word word");
  expect((await a.get("/api/friends")).data.followers).toBe(1);
  expect((await b.post("/api/friends", { username: "nobody_here" })).status).toBe(404);
  expect((await b.post("/api/friends", { username: "writer_b" })).status).toBe(400);
  await b.del("/api/friends/writer_a");
  expect((await b.get("/api/friends")).data.friends.length).toBe(0);
});

test("cross-site writes are refused", async () => {
  const c = await user("csrf_check");
  const res = await handle(new Request("http://localhost/api/projects", {
    method: "POST", headers: { cookie: c.cookie, "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ type: "poem", title: "x" }),
  }), null);
  expect(res.status).toBe(403);
});

test("password change and account deletion", async () => {
  const c = await user("leaver");
  expect((await c.put("/api/me/password", { current: "wrong pass", next: "new password" })).status).toBe(401);
  expect((await c.put("/api/me/password", { current: "correct horse", next: "new password" })).status).toBe(200);
  expect((await new Client().post("/api/login", { username: "leaver", password: "new password" })).status).toBe(200);
  expect((await c.post("/api/me/delete", { password: "nope" })).status).toBe(401);
  expect((await c.post("/api/me/delete", { password: "new password" })).status).toBe(200);
  expect((await new Client().post("/api/login", { username: "leaver", password: "new password" })).status).toBe(401);
});

// ---------------------------------------------------------------------------
// Import
const { mailer } = await import("../src/mail");
const { deps } = await import("../src/server");
const fixture = (n: string) => Bun.file(new URL(`./fixtures/${n}`, import.meta.url)).arrayBuffer();

async function upload(c: Client, name: string, data: ArrayBuffer | string) {
  const form = new FormData();
  form.append("file", new File([data], name));
  const res = await handle(new Request("http://localhost/api/import/parse", { method: "POST", headers: { cookie: c.cookie }, body: form }), null);
  return { status: res.status, data: await res.json() };
}

test("import a Word novel: headings become chapters and scenes, breaks split scenes", async () => {
  const c = await user("importer");
  const r = await upload(c, "The_Lighthouse.docx", await fixture("novel.docx"));
  expect(r.status).toBe(200);
  expect(r.data.title).toBe("The Lighthouse Keeper");
  expect(r.data.suggestedType).toBe("novel");
  const prev = (await c.post("/api/import/preview", { type: "novel", blocks: r.data.blocks })).data;
  expect(prev.kind).toBe("containers");
  expect(prev.containers.map((x: any) => x.title)).toEqual(["Chapter One: The Rock", "Chapter Two"]);
  expect(prev.containers[0].scenes.map((x: any) => x.title)).toEqual(["Arrival", "The Lamp Room", "Scene 3"]);
  const before = (await c.get("/api/stats")).data.todayWords;
  const made = await c.post("/api/import", { type: "novel", title: "The Lighthouse Keeper", blocks: r.data.blocks });
  expect(made.status).toBe(201);
  const ms = (await c.get(`/api/projects/${made.data.project.id}/manuscript`)).data.parts;
  expect(ms[0].body).toContain("forty-one");
  expect(ms[0].body).toContain("&");
  expect(ms[3].body).toContain("<late>");
  expect(ms[3].body).toContain("A line of verse\nand the next line");
  // Imported words don't count toward today's 500 — but new words added afterward do.
  expect((await c.get("/api/stats")).data.todayWords).toBe(before);
  await c.put(`/api/nodes/${ms[0].id}`, { body: ms[0].body + " Five more words right here." });
  expect((await c.get("/api/stats")).data.todayWords).toBe(before + 5);
});

test("import as other types, and plain text / markdown", async () => {
  const c = await user("importer2");
  const r = (await upload(c, "x.docx", await fixture("novel.docx"))).data;
  const play = (await c.post("/api/import/preview", { type: "play", blocks: r.blocks })).data;
  expect(play.containers.length).toBe(2);
  const story = (await c.post("/api/import/preview", { type: "short_story", blocks: r.blocks })).data;
  expect(story.scenes.map((s: any) => s.title)).toEqual(["Chapter One: The Rock", "Arrival", "The Lamp Room", "Scene 4", "Chapter Two"]);
  const page = (await c.post("/api/import/preview", { type: "freeform", blocks: r.blocks })).data;
  expect(page.kind).toBe("page");

  const plain = (await upload(c, "notes.docx", await fixture("plain.docx"))).data;
  expect(plain.suggestedType).toBe("freeform");
  const md = (await upload(c, "draft.md", "# Part One\n\nIt began.\n\n## The Door\n\nShe knocked.\n\n***\n\nNobody came.")).data;
  expect(md.suggestedType).toBe("novel");
  const mdPrev = (await c.post("/api/import/preview", { type: "novel", blocks: md.blocks })).data;
  expect(mdPrev.containers[0].title).toBe("Part One");
  expect(mdPrev.containers[0].scenes.map((s: any) => s.title)).toEqual(["Scene 1", "The Door", "Scene 3"]);
  const txt = (await upload(c, "story.txt", "First bit.\n\n* * *\n\nSecond bit.")).data;
  expect(txt.suggestedType).toBe("short_story");
  expect((await upload(c, "old.doc", "x")).status).toBe(400);
  expect((await upload(c, "fake.docx", "not a zip")).status).toBe(400);
  expect((await upload(c, "empty.txt", "   ")).status).toBe(400);
});

test("import from a Google Docs link only fetches Google's export URL", async () => {
  const c = await user("googler");
  const doc = await fixture("novel.docx");
  const seen: string[] = [];
  const real = deps.fetch;
  deps.fetch = (async (u: any) => {
    seen.push(String(u));
    if (String(u).includes("SHAREDdoc")) return new Response(doc, { status: 200 });
    return new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as any;
  try {
    const ok = await c.post("/api/import/parse", { url: "https://docs.google.com/document/d/SHAREDdoc_aaaaaaaaaaaaaaaa/edit?usp=sharing" });
    expect(ok.status).toBe(200);
    expect(ok.data.words).toBeGreaterThan(20);
    expect(seen[0]).toBe("https://docs.google.com/document/d/SHAREDdoc_aaaaaaaaaaaaaaaa/export?format=docx");
    const priv = await c.post("/api/import/parse", { url: "https://docs.google.com/document/d/PRIVATEdoc_aaaaaaaaaaaaaa/edit" });
    expect(priv.status).toBe(400);
    expect(priv.data.error).toContain("Anyone with the link");
    const evil = await c.post("/api/import/parse", { url: "http://169.254.169.254/latest/meta-data" });
    expect(evil.status).toBe(400);
    expect(seen.length).toBe(2);
  } finally {
    deps.fetch = real;
  }
});

// ---------------------------------------------------------------------------
// Password reset
test("password reset by email", async () => {
  const sent: any[] = [];
  const realSend = mailer.send, realEnabled = mailer.enabled;
  process.env.APP_URL = "https://500words.org";
  mailer.enabled = () => true;
  mailer.send = async (m: any) => { sent.push(m); };
  try {
    const c = new Client();
    expect((await c.post("/api/signup", { username: "forgetful", password: "first password", email: "Forgetful@Example.com" })).status).toBe(201);
    expect((await c.post("/api/signup", { username: "bademail", password: "first password", email: "nope" })).status).toBe(400);
    const me = (await c.get("/api/me")).data;
    expect(me.user.email).toBe("Forgetful@Example.com");
    expect(me.resetEnabled).toBe(true);

    // Unknown accounts get the same answer and no email.
    expect((await new Client().post("/api/password/forgot", { who: "nobody_at_all" })).status).toBe(200);
    expect(sent.length).toBe(0);
    // By email, case-insensitive.
    expect((await new Client().post("/api/password/forgot", { who: "forgetful@example.com" })).status).toBe(200);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe("Forgetful@Example.com");
    const link = sent[0].text.match(/https:\/\/500words\.org\/reset\?token=(\S+)/);
    expect(link).toBeTruthy();
    const token = link[1];

    const anon = new Client();
    expect((await anon.get(`/api/password/reset?token=${token}`)).data.username).toBe("forgetful");
    expect((await anon.post("/api/password/reset", { token, password: "short" })).status).toBe(400);
    const done = await anon.post("/api/password/reset", { token, password: "brand new password" });
    expect(done.status).toBe(200);
    expect((await anon.get("/api/projects")).status).toBe(200);   // signed in
    expect((await c.get("/api/projects")).status).toBe(401);      // old sessions signed out
    expect((await anon.post("/api/password/reset", { token, password: "again again" })).status).toBe(410); // single use
    expect((await new Client().post("/api/login", { username: "forgetful", password: "brand new password" })).status).toBe(200);

    // Expired links don't work.
    await new Client().post("/api/password/forgot", { who: "forgetful" });
    const t2 = sent[1].text.match(/token=(\S+)/)[1];
    await sql`update password_resets set expires_at = now() - interval '1 minute'`;
    expect((await anon.post("/api/password/reset", { token: t2, password: "whatever123" })).status).toBe(410);

    // Accounts without an email can't be reset (and nothing is sent).
    await user("no_email_here");
    await new Client().post("/api/password/forgot", { who: "no_email_here" });
    expect(sent.length).toBe(2);
    // Email can be added and removed in settings.
    const x = new Client();
    await x.post("/api/login", { username: "forgetful", password: "brand new password" });
    expect((await x.put("/api/me", { email: "" })).data.user.email).toBeNull();
  } finally {
    mailer.send = realSend; mailer.enabled = realEnabled; delete process.env.APP_URL;
  }
});

test("reset is refused politely when email isn't configured", async () => {
  const realEnabled = mailer.enabled;
  mailer.enabled = () => false;
  try {
    const r = await new Client().post("/api/password/forgot", { who: "anyone" });
    expect(r.status).toBe(503);
    expect((await new Client().get("/api/me")).data.resetEnabled).toBe(false);
  } finally { mailer.enabled = realEnabled; }
});


// ---------------------------------------------------------------------------
// Formatting, Word export, sharing
const fmt = await import("../src/format");
const mammothLib = (await import("mammoth")).default;

test("stored format: bold/italic marks and escapes round-trip", () => {
  const body = "She was _not_ going back. **Never.**\nSnake\\_case and 2\\*3 stay \\\\ literal.\n**bold and _both_**";
  const lines = fmt.parseBody(body);
  expect(lines[0]).toEqual([
    { text: "She was ", b: false, i: false }, { text: "not", b: false, i: true },
    { text: " going back. ", b: false, i: false }, { text: "Never.", b: true, i: false },
  ]);
  expect(fmt.toPlain(body).split("\n")[1]).toBe("Snake_case and 2*3 stay \\ literal.");
  expect(lines[2]).toEqual([{ text: "bold and ", b: true, i: false }, { text: "both", b: true, i: true }]);
  expect(fmt.escapeText("a*b_c\\")).toBe("a\\*b\\_c\\\\");
  expect(countWords(body)).toBe(16);
  expect(fmt.fromMarkdown("It was *very* __bold__ of snake_case")).toBe("It was _very_ **bold** of snake\\_case");
});

test("Word import keeps bold and italics, and literal * and _", async () => {
  const c = await user("fmt_importer");
  const r = (await upload(c, "f.docx", await fixture("formatted.docx"))).data;
  const para = r.blocks.find((b: any) => b.t === "p").text;
  expect(para).toBe("She was _not_ going back. **Never.** Snake\\_case and 2\\*3 stay literal.");
});

test("converting to one page can leave out the scene breaks", async () => {
  const c = await user("nobreaks");
  const p = (await c.post("/api/projects", { type: "short_story", title: "S" })).data.project;
  let { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  const s1 = nodes.find((n: any) => n.kind === "scene");
  await c.put(`/api/nodes/${s1.id}`, { body: "First." });
  const s2 = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene" })).data.node;
  await c.put(`/api/nodes/${s2.id}`, { body: "Second." });
  await c.post(`/api/projects/${p.id}/convert`, { type: "freeform", breaks: false });
  ({ nodes } = (await c.get(`/api/projects/${p.id}`)).data);
  const page = (await c.get(`/api/nodes/${nodes.find((n: any) => n.kind === "page").id}`)).data.node;
  expect(page.body).toBe("First.\n\nSecond.");
});

async function docxText(c: Client, path: string) {
  const res = await handle(new Request("http://localhost" + path, { headers: { cookie: c.cookie } }), null);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("wordprocessingml");
  const buf = Buffer.from(await res.arrayBuffer());
  return (await mammothLib.convertToHtml({ buffer: buf })).value;
}

test("Word export: chapters, scene titles and breaks as chosen, bold and italics kept", async () => {
  const c = await user("exporter");
  const p = (await c.post("/api/projects", { type: "novel", title: "Lamp & Rock" })).data.project;
  let { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  const ch = nodes.find((n: any) => n.kind === "chapter");
  const s1 = nodes.find((n: any) => n.kind === "scene");
  await c.put(`/api/nodes/${s1.id}`, { title: "Arrival", body: "She was _not_ going back.\n\n**Never.**" });
  const s2 = (await c.post(`/api/projects/${p.id}/nodes`, { kind: "scene", parentId: ch.id, title: "Night" })).data.node;
  await c.put(`/api/nodes/${s2.id}`, { body: "The lamp failed." });

  let html = await docxText(c, `/api/projects/${p.id}/export.docx?titles=1&breaks=1`);
  expect(html).toContain("Lamp &amp; Rock");
  expect(html).toContain("<h1>Chapter 1</h1>");
  expect(html).toContain("<h2>Arrival</h2>");
  expect(html).toContain("<em>not</em>");
  expect(html).toContain("<strong>Never.</strong>");
  expect(html).toContain("* * *");
  html = await docxText(c, `/api/projects/${p.id}/export.docx?titles=0&breaks=0`);
  expect(html).not.toContain("Arrival");
  expect(html).not.toContain("* * *");
  expect(html).toContain("The lamp failed.");
  // Someone else can't export it.
  const other = await user("not_the_owner");
  const res = await handle(new Request(`http://localhost/api/projects/${p.id}/export.docx`, { headers: { cookie: other.cookie } }), null);
  expect(res.status).toBe(404);
});

test("sharing one story by link", async () => {
  const c = await user("sharer");
  const p = (await c.post("/api/projects", { type: "short_story", title: "Shared Tale" })).data.project;
  let { nodes } = (await c.get(`/api/projects/${p.id}`)).data;
  const scene = nodes.find((n: any) => n.kind === "scene");
  await c.put(`/api/nodes/${scene.id}`, { body: "Once, _quietly_." });
  await c.put(`/api/nodes/${nodes.find((n: any) => n.kind === "overview").id}`, { body: "SECRET PLOT NOTES" });
  await c.put(`/api/nodes/${scene.id}`, { summary: "private scene note" });
  const other = (await c.post("/api/projects", { type: "freeform", title: "Diary" })).data.project;

  expect((await c.get(`/api/projects/${p.id}/share`)).data.token).toBeNull();
  const on = (await c.post(`/api/projects/${p.id}/share`, { enabled: true })).data;
  expect(on.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  const anon = new Client();
  const view = await anon.get(`/api/shared/${on.token}`);
  expect(view.status).toBe(200);
  expect(view.data.project).toEqual({ title: "Shared Tale", type: "short_story", author: "sharer" });
  expect(view.data.parts[0].body).toBe("Once, _quietly_.");
  const raw = JSON.stringify(view.data);
  expect(raw).not.toContain("SECRET PLOT");
  expect(raw).not.toContain("private scene note");
  expect(raw).not.toContain("Diary");
  expect(raw).not.toContain(`"id"`);

  const opts = (await c.post(`/api/projects/${p.id}/share`, { titles: false, breaks: false })).data;
  expect(opts.token).toBe(on.token);
  expect((await anon.get(`/api/shared/${on.token}`)).data.titles).toBe(false);

  // A new link retires the old one; turning sharing off retires it too.
  const fresh = (await c.post(`/api/projects/${p.id}/share`, { enabled: true, newLink: true })).data;
  expect(fresh.token).not.toBe(on.token);
  expect((await anon.get(`/api/shared/${on.token}`)).status).toBe(404);
  expect((await anon.get(`/api/shared/${fresh.token}`)).status).toBe(200);
  await c.post(`/api/projects/${p.id}/share`, { enabled: false });
  expect((await anon.get(`/api/shared/${fresh.token}`)).status).toBe(404);

  // Only the owner controls sharing.
  const stranger = await user("share_stranger");
  expect((await stranger.post(`/api/projects/${p.id}/share`, { enabled: true })).status).toBe(404);
  expect((await anon.post(`/api/projects/${p.id}/share`, { enabled: true })).status).toBe(401);
  expect((await anon.get(`/api/shared/not-a-real-token`)).status).toBe(404);
});
