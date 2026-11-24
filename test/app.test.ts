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
  expect(full.body).toBe("Once upon a time there was a lamp.\n\n* * *\n\nThe lamp went out.");
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
