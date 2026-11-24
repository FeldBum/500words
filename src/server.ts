import { sql, migrate } from "./db";
import { countWords, dayIn, validTimezone, streaks, DAILY_GOAL } from "./words";
import { TYPES, isType, containerTitle, type ProjectType } from "./types";
import { join, normalize } from "node:path";

// ---------------------------------------------------------------------------
// 500words — a writing room. There is no AI anywhere in this app: no text
// generation, suggestions, rewriting or completion, on the server or in the
// browser. Every word stored here was written by the person who owns it.
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const SESSION_DAYS = 90;
const COOKIE = "w5s";
const MAX_BODY_CHARS = 2_000_000;
const IS_PROD = process.env.NODE_ENV === "production";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string) => new HttpError(400, msg);
const notFound = () => new HttpError(404, "Not found");

// ---------- helpers ---------------------------------------------------------

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
};

function withSecurity(res: Response) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (IS_PROD) res.headers.set("strict-transport-security", "max-age=31536000");
  return res;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Buffer.from(buf).toString("hex");
}

function newToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

function getCookie(req: Request, name: string) {
  const h = req.headers.get("cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${IS_PROD ? "; Secure" : ""}`;
}

function clientIp(req: Request, server: any) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return server?.requestIP?.(req)?.address ?? "unknown";
}

// Simple in-memory limiter for sign-in and sign-up.
const attempts = new Map<string, { n: number; reset: number }>();
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  a.n++;
  if (a.n > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 60_000).unref?.();

async function body(req: Request): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw bad("Expected JSON");
  try {
    return await req.json();
  } catch {
    throw bad("Invalid JSON");
  }
}

function str(v: unknown, max: number, field: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw bad(`${field} must be text`);
  if (v.length > max) throw bad(`${field} is too long`);
  return v;
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

// ---------- auth ------------------------------------------------------------

interface User {
  id: number;
  username: string;
  display_name: string;
  is_public: boolean;
  timezone: string;
}

async function currentUser(req: Request): Promise<User | null> {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const h = await sha256(token);
  const rows = await sql`
    select u.id, u.username, u.display_name, u.is_public, u.timezone
    from sessions s join users u on u.id = s.user_id
    where s.token = ${h} and s.expires_at > now()`;
  return (rows[0] as User) ?? null;
}

async function startSession(userId: number) {
  const token = newToken();
  const h = await sha256(token);
  await sql`insert into sessions (token, user_id, expires_at)
            values (${h}, ${userId}, now() + ${SESSION_DAYS + " days"}::interval)`;
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function publicUser(u: User) {
  return { id: u.id, username: u.username, displayName: u.display_name, isPublic: u.is_public, timezone: u.timezone };
}

// ---------- word tracking ---------------------------------------------------

async function todayWords(userId: number, day: string, db = sql): Promise<number> {
  const r = await db`
    select coalesce(sum(greatest(0, current - baseline - pasted)), 0)::int as w
    from node_days where user_id = ${userId} and day = ${day}::date`;
  return r[0].w;
}

async function statsFor(user: { id: number; timezone: string }) {
  const today = dayIn(user.timezone);
  const rows = await sql`
    select day::text as day, sum(greatest(0, current - baseline - pasted))::int as words
    from node_days where user_id = ${user.id}
    group by day order by day`;
  const byDay = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.words > 0) byDay.set(r.day, r.words);
    total += r.words;
  }
  const s = streaks(byDay, today);
  return {
    goal: DAILY_GOAL,
    today,
    todayWords: byDay.get(today) ?? 0,
    streak: s.current,
    longestStreak: s.longest,
    daysMet: s.daysMet,
    totalWords: total,
    daysWritten: byDay.size,
    history: [...byDay.entries()].map(([day, words]) => ({ day, words })),
  };
}

// When the app itself moves text between nodes (converting a project), the
// moved words were not written today, so shift the day's baseline with them.
async function shiftBaseline(db: any, userId: number, nodeId: number, day: string, delta: number) {
  if (!delta) return;
  await db`update node_days set baseline = baseline + ${delta}, current = current + ${delta}
           where user_id = ${userId} and node_id = ${nodeId} and day = ${day}::date`;
}

// ---------- ownership helpers ----------------------------------------------

async function ownProject(userId: number, projectId: number, db: any = sql) {
  const r = await db`select * from projects where id = ${projectId} and user_id = ${userId}`;
  if (!r.length) throw notFound();
  return r[0];
}

async function ownNode(userId: number, nodeId: number, db: any = sql, lock = false) {
  const r = lock
    ? await db`select n.*, p.type as project_type from nodes n join projects p on p.id = n.project_id
               where n.id = ${nodeId} and p.user_id = ${userId} for update of n`
    : await db`select n.*, p.type as project_type from nodes n join projects p on p.id = n.project_id
               where n.id = ${nodeId} and p.user_id = ${userId}`;
  if (!r.length) throw notFound();
  return r[0];
}

function toNode(n: any, withBody = false) {
  const o: any = {
    id: n.id,
    parentId: n.parent_id,
    kind: n.kind,
    title: n.title,
    summary: n.summary,
    words: n.words,
    position: n.position,
    updatedAt: n.updated_at,
  };
  if (withBody) o.body = n.body;
  return o;
}

async function nextPosition(db: any, projectId: number, parentId: number | null) {
  const r = parentId === null
    ? await db`select coalesce(max(position), 0) + 1 as p from nodes where project_id = ${projectId} and parent_id is null`
    : await db`select coalesce(max(position), 0) + 1 as p from nodes where project_id = ${projectId} and parent_id = ${parentId}`;
  return Number(r[0].p);
}

async function insertNode(db: any, projectId: number, parentId: number | null, kind: string, title: string, extra: { body?: string; summary?: string } = {}) {
  const position = await nextPosition(db, projectId, parentId);
  const b = extra.body ?? "";
  const r = await db`
    insert into nodes (project_id, parent_id, kind, title, summary, body, words, position)
    values (${projectId}, ${parentId}, ${kind}, ${title}, ${extra.summary ?? ""}, ${b}, ${countWords(b)}, ${position})
    returning *`;
  return r[0];
}

async function touchProject(db: any, projectId: number) {
  await db`update projects set updated_at = now() where id = ${projectId}`;
}

// Scenes/pages in reading order.
function orderedLeaves(nodes: any[]) {
  const byParent = new Map<number | null, any[]>();
  for (const n of nodes) {
    const k = n.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || a.id - b.id);
  const out: any[] = [];
  for (const top of byParent.get(null) ?? []) {
    if (top.kind === "scene" || top.kind === "page") out.push(top);
    else if (top.kind === "chapter" || top.kind === "act")
      for (const c of byParent.get(top.id) ?? []) if (c.kind === "scene" || c.kind === "page") out.push(c);
  }
  return out;
}

// ---------- project structure ----------------------------------------------

async function createProject(db: any, userId: number, type: ProjectType, title: string) {
  const r = await db`insert into projects (user_id, type, title) values (${userId}, ${type}, ${title}) returning *`;
  const p = r[0];
  const def = TYPES[type];
  if (def.single) {
    await insertNode(db, p.id, null, "page", "");
  } else {
    await insertNode(db, p.id, null, "overview", "Overview");
    if (def.container) {
      const c = await insertNode(db, p.id, null, def.container, containerTitle(def.container, 1));
      await insertNode(db, p.id, c.id, "scene", "Scene 1");
    } else {
      await insertNode(db, p.id, null, "scene", "Scene 1");
    }
  }
  return p;
}

async function convertProject(db: any, user: User, project: any, target: ProjectType) {
  if (project.type === target) return;
  const def = TYPES[target];
  const day = dayIn(user.timezone);
  const nodes = await db`select * from nodes where project_id = ${project.id}`;
  const leaves = orderedLeaves(nodes);
  const containers = nodes.filter((n: any) => n.kind === "chapter" || n.kind === "act")
    .sort((a: any, b: any) => a.position - b.position || a.id - b.id);

  if (def.single) {
    // Everything becomes one page. Scenes are joined in reading order.
    let page = leaves[0];
    if (!page) {
      page = await insertNode(db, project.id, null, "page", "");
    } else if (leaves.length > 1) {
      const joined = leaves.map((l: any) => l.body.trim()).filter(Boolean).join("\n\n* * *\n\n");
      const w = countWords(joined);
      await shiftBaseline(db, user.id, page.id, day, w - page.words);
      await db`update nodes set body = ${joined}, words = ${w}, updated_at = now() where id = ${page.id}`;
      const others = leaves.slice(1).map((l: any) => l.id);
      await db`delete from nodes where id in ${db(others)}`;
    }
    await db`update nodes set kind = 'page', parent_id = null, title = '', position = 1 where id = ${page.id}`;
    if (containers.length) await db`delete from nodes where id in ${db(containers.map((c: any) => c.id))}`;
  } else {
    if (!nodes.some((n: any) => n.kind === "overview")) {
      await db`insert into nodes (project_id, parent_id, kind, title, position) values (${project.id}, null, 'overview', 'Overview', 0)`;
    }
    // Scenes keep their order; give untitled pages a scene title.
    let i = 1;
    for (const l of leaves) {
      const title = l.title || `Scene ${i}`;
      await db`update nodes set kind = 'scene', title = ${title} where id = ${l.id}`;
      i++;
    }
    if (def.container) {
      if (containers.length) {
        // Chapters become acts or the other way round; titles stay.
        await db`update nodes set kind = ${def.container} where id in ${db(containers.map((c: any) => c.id))}`;
        const loose = leaves.filter((l: any) => l.parent_id === null);
        if (loose.length) {
          let pos = await nextPosition(db, project.id, containers[containers.length - 1].id);
          for (const l of loose) await db`update nodes set parent_id = ${containers[containers.length - 1].id}, position = ${pos++} where id = ${l.id}`;
        }
      } else {
        const c = await insertNode(db, project.id, null, def.container, containerTitle(def.container, 1));
        let pos = 1;
        for (const l of leaves) await db`update nodes set parent_id = ${c.id}, position = ${pos++} where id = ${l.id}`;
        if (!leaves.length) await insertNode(db, project.id, c.id, "scene", "Scene 1");
      }
    } else {
      // No containers: scenes sit at the top level in reading order.
      let pos = 1;
      for (const l of leaves) await db`update nodes set parent_id = null, position = ${pos++} where id = ${l.id}`;
      if (containers.length) await db`delete from nodes where id in ${db(containers.map((c: any) => c.id))}`;
      if (!leaves.length) await insertNode(db, project.id, null, "scene", "Scene 1");
    }
  }
  await db`update projects set type = ${target}, updated_at = now() where id = ${project.id}`;
}

// ---------- routes ----------------------------------------------------------

type Ctx = { req: Request; url: URL; params: Record<string, string>; server: any };
type Handler = (c: Ctx, user: User | null) => Promise<Response>;
const routes: { method: string; re: RegExp; keys: string[]; auth: boolean; h: Handler }[] = [];

function route(method: string, path: string, auth: boolean, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, auth, h });
}

function id(v: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

route("GET", "/healthz", false, async () => {
  await sql`select 1`;
  return json({ ok: true });
});

route("POST", "/api/signup", false, async ({ req, server }) => {
  limit("signup:" + clientIp(req, server), 10, 60 * 60_000);
  const b = await body(req);
  const username = str(b.username, 64, "Username").trim().toLowerCase();
  const password = str(b.password, 200, "Password");
  const displayName = str(b.displayName, 60, "Name").trim() || username;
  if (!USERNAME_RE.test(username)) throw bad("Usernames are 3–24 characters: lowercase letters, numbers and underscores.");
  if (password.length < 8) throw bad("Passwords need at least 8 characters.");
  const tz = validTimezone(b.timezone) ? b.timezone : "America/New_York";
  const exists = await sql`select 1 from users where username = ${username}`;
  if (exists.length) throw new HttpError(409, "That username is taken.");
  const hash = await Bun.password.hash(password);
  const r = await sql`insert into users (username, display_name, password_hash, timezone)
                      values (${username}, ${displayName}, ${hash}, ${tz}) returning id, username, display_name, is_public, timezone`;
  const cookie = await startSession(r[0].id);
  return json({ user: publicUser(r[0] as User) }, 201, { "set-cookie": cookie });
});

route("POST", "/api/login", false, async ({ req, server }) => {
  const b = await body(req);
  const username = str(b.username, 64, "Username").trim().toLowerCase();
  const password = str(b.password, 200, "Password");
  limit("login:" + clientIp(req, server), 30, 15 * 60_000);
  limit("login-user:" + username, 10, 15 * 60_000);
  const r = await sql`select * from users where username = ${username}`;
  const ok = r.length && (await Bun.password.verify(password, r[0].password_hash));
  if (!ok) throw new HttpError(401, "That username and password don't match.");
  if (validTimezone(b.timezone) && b.timezone !== r[0].timezone) {
    await sql`update users set timezone = ${b.timezone} where id = ${r[0].id}`;
    r[0].timezone = b.timezone;
  }
  const cookie = await startSession(r[0].id);
  return json({ user: publicUser(r[0] as User) }, 200, { "set-cookie": cookie });
});

route("POST", "/api/logout", false, async ({ req }) => {
  const token = getCookie(req, COOKIE);
  if (token) await sql`delete from sessions where token = ${await sha256(token)}`;
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
});

route("GET", "/api/me", false, async (_c, user) => {
  if (!user) return json({ user: null });
  return json({ user: publicUser(user) });
});

route("PUT", "/api/me", true, async ({ req }, user) => {
  const b = await body(req);
  const u = user!;
  const displayName = b.displayName !== undefined ? str(b.displayName, 60, "Name").trim() || u.username : u.display_name;
  const isPublic = b.isPublic !== undefined ? !!b.isPublic : u.is_public;
  const tz = b.timezone !== undefined ? (validTimezone(b.timezone) ? b.timezone : u.timezone) : u.timezone;
  const r = await sql`update users set display_name = ${displayName}, is_public = ${isPublic}, timezone = ${tz}
                      where id = ${u.id} returning id, username, display_name, is_public, timezone`;
  return json({ user: publicUser(r[0] as User) });
});

route("PUT", "/api/me/password", true, async ({ req }, user) => {
  const b = await body(req);
  const current = str(b.current, 200, "Password");
  const next = str(b.next, 200, "Password");
  if (next.length < 8) throw bad("Passwords need at least 8 characters.");
  const r = await sql`select password_hash from users where id = ${user!.id}`;
  if (!(await Bun.password.verify(current, r[0].password_hash))) throw new HttpError(401, "Your current password isn't right.");
  await sql`update users set password_hash = ${await Bun.password.hash(next)} where id = ${user!.id}`;
  // Sign out every other device.
  const token = getCookie(req, COOKIE);
  await sql`delete from sessions where user_id = ${user!.id} and token <> ${await sha256(token || "")}`;
  return json({ ok: true });
});

route("POST", "/api/me/delete", true, async ({ req }, user) => {
  const b = await body(req);
  const r = await sql`select password_hash from users where id = ${user!.id}`;
  if (!(await Bun.password.verify(str(b.password, 200, "Password"), r[0].password_hash)))
    throw new HttpError(401, "That password isn't right.");
  await sql`delete from users where id = ${user!.id}`;
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
});

// ---- projects

route("GET", "/api/projects", true, async (_c, user) => {
  const rows = await sql`
    select p.id, p.type, p.title, p.created_at, p.updated_at,
      coalesce(sum(n.words) filter (where n.kind in ('scene','page')), 0)::int as words,
      count(*) filter (where n.kind = 'scene')::int as scenes,
      count(*) filter (where n.kind in ('chapter','act'))::int as containers
    from projects p left join nodes n on n.project_id = p.id
    where p.user_id = ${user!.id}
    group by p.id order by p.updated_at desc`;
  return json({
    projects: rows.map((r: any) => ({
      id: r.id, type: r.type, title: r.title, words: r.words, scenes: r.scenes, containers: r.containers,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
});

route("POST", "/api/projects", true, async ({ req }, user) => {
  const b = await body(req);
  if (!isType(b.type)) throw bad("Pick a kind of project.");
  const title = str(b.title, 200, "Title").trim() || "Untitled";
  const p = await sql.begin((tx) => createProject(tx, user!.id, b.type, title));
  return json({ project: { id: p.id, type: p.type, title: p.title } }, 201);
});

route("GET", "/api/projects/:id", true, async ({ params }, user) => {
  const p = await ownProject(user!.id, id(params.id));
  const nodes = await sql`select id, parent_id, kind, title, summary, words, position, updated_at
                          from nodes where project_id = ${p.id} order by position, id`;
  return json({
    project: { id: p.id, type: p.type, title: p.title, updatedAt: p.updated_at },
    nodes: nodes.map((n: any) => toNode(n)),
  });
});

route("PUT", "/api/projects/:id", true, async ({ req, params }, user) => {
  const p = await ownProject(user!.id, id(params.id));
  const b = await body(req);
  const title = str(b.title, 200, "Title").trim() || "Untitled";
  await sql`update projects set title = ${title}, updated_at = now() where id = ${p.id}`;
  return json({ ok: true, title });
});

route("DELETE", "/api/projects/:id", true, async ({ params }, user) => {
  const p = await ownProject(user!.id, id(params.id));
  await sql`delete from projects where id = ${p.id}`;
  return json({ ok: true });
});

route("POST", "/api/projects/:id/convert", true, async ({ req, params }, user) => {
  const b = await body(req);
  if (!isType(b.type)) throw bad("Pick a kind of project.");
  await sql.begin(async (tx) => {
    const p = await ownProject(user!.id, id(params.id), tx);
    await tx`select id from nodes where project_id = ${p.id} for update`;
    await convertProject(tx, user!, p, b.type);
  });
  return json({ ok: true });
});

route("GET", "/api/projects/:id/manuscript", true, async ({ params }, user) => {
  const p = await ownProject(user!.id, id(params.id));
  const nodes = await sql`select * from nodes where project_id = ${p.id}`;
  const containers = new Map(nodes.filter((n: any) => n.kind === "chapter" || n.kind === "act").map((n: any) => [n.id, n]));
  const parts = orderedLeaves(nodes).map((l: any) => ({
    id: l.id,
    title: l.title,
    container: l.parent_id ? (containers.get(l.parent_id) as any)?.title ?? null : null,
    containerId: l.parent_id,
    body: l.body,
    words: l.words,
  }));
  return json({ project: { id: p.id, type: p.type, title: p.title }, parts });
});

// ---- nodes

route("POST", "/api/projects/:id/nodes", true, async ({ req, params }, user) => {
  const b = await body(req);
  const node = await sql.begin(async (tx) => {
    const p = await ownProject(user!.id, id(params.id), tx);
    const def = TYPES[p.type as ProjectType];
    if (def.single) throw bad("Poems and freeform pieces are a single page.");
    const kind = b.kind;
    let parentId: number | null = null;
    let title = str(b.title, 200, "Title").trim();
    if (kind === "character") {
      title ||= "New character";
    } else if (kind === "chapter" || kind === "act") {
      if (def.container !== kind) throw bad("That doesn't belong in this kind of project.");
      const n = await tx`select count(*)::int as c from nodes where project_id = ${p.id} and kind = ${kind}`;
      title ||= containerTitle(kind, n[0].c + 1);
    } else if (kind === "scene") {
      if (def.container) {
        const parent = await tx`select id from nodes where id = ${Number(b.parentId) || 0} and project_id = ${p.id} and kind = ${def.container}`;
        if (!parent.length) throw bad(`Scenes go inside a ${def.containerLabel!.toLowerCase()}.`);
        parentId = parent[0].id;
        const n = await tx`select count(*)::int as c from nodes where parent_id = ${parentId} and kind = 'scene'`;
        title ||= `Scene ${n[0].c + 1}`;
      } else {
        const n = await tx`select count(*)::int as c from nodes where project_id = ${p.id} and kind = 'scene'`;
        title ||= `Scene ${n[0].c + 1}`;
      }
    } else {
      throw bad("Unknown section type.");
    }
    const created = await insertNode(tx, p.id, parentId, kind, title);
    await touchProject(tx, p.id);
    return created;
  });
  return json({ node: toNode(node) }, 201);
});

route("GET", "/api/nodes/:id", true, async ({ params }, user) => {
  const n = await ownNode(user!.id, id(params.id));
  const day = dayIn(user!.timezone);
  const r = await sql`select baseline, current, pasted from node_days where user_id = ${user!.id} and node_id = ${n.id} and day = ${day}::date`;
  return json({
    node: toNode(n, true),
    day: r[0] ? { baseline: r[0].baseline, pasted: r[0].pasted } : { baseline: n.words, pasted: 0 },
    todayWords: await todayWords(user!.id, day),
  });
});

route("PUT", "/api/nodes/:id", true, async ({ req, params }, user) => {
  const b = await body(req);
  const day = dayIn(user!.timezone);
  const result = await sql.begin(async (tx) => {
    const n = await ownNode(user!.id, id(params.id), tx, true);
    const title = b.title !== undefined ? str(b.title, 200, "Title") : n.title;
    const summary = b.summary !== undefined ? str(b.summary, 20_000, "Notes") : n.summary;
    let dayRow = null;
    if (b.body !== undefined) {
      const text = str(b.body, MAX_BODY_CHARS, "Text");
      const words = countWords(text);
      const pastedDelta = Math.max(0, Math.min(Number(b.pasted) || 0, words));
      const existing = await tx`select * from node_days where user_id = ${user!.id} and node_id = ${n.id} and day = ${day}::date for update`;
      const baseline = existing[0]?.baseline ?? n.words;
      const prevCurrent = existing[0]?.current ?? n.words;
      const removed = Math.max(0, prevCurrent - words);
      // Words deleted are taken off the pasted tally first, so pasting
      // something and then deleting it doesn't cost you anything.
      const pasted = Math.max(0, (existing[0]?.pasted ?? 0) + pastedDelta - removed);
      await tx`insert into node_days (user_id, node_id, day, baseline, current, pasted)
               values (${user!.id}, ${n.id}, ${day}::date, ${baseline}, ${words}, ${pasted})
               on conflict (user_id, node_id, day) do update set current = ${words}, pasted = ${pasted}`;
      await tx`update nodes set body = ${text}, words = ${words}, title = ${title}, summary = ${summary}, updated_at = now() where id = ${n.id}`;
      dayRow = { baseline, pasted };
      n.words = words;
    } else {
      await tx`update nodes set title = ${title}, summary = ${summary}, updated_at = now() where id = ${n.id}`;
    }
    await touchProject(tx, n.project_id);
    return { words: n.words, dayRow, todayWords: await todayWords(user!.id, day, tx) };
  });
  return json({ ok: true, words: result.words, day: result.dayRow, todayWords: result.todayWords });
});

route("DELETE", "/api/nodes/:id", true, async ({ params }, user) => {
  await sql.begin(async (tx) => {
    const n = await ownNode(user!.id, id(params.id), tx, true);
    if (n.kind === "overview" || n.kind === "page") throw bad("That section can't be removed.");
    if (n.kind === "chapter" || n.kind === "act") {
      const left = await tx`select count(*)::int as c from nodes where project_id = ${n.project_id} and kind = ${n.kind}`;
      if (left[0].c <= 1) throw bad(`A project needs at least one ${n.kind}.`);
    }
    await tx`delete from nodes where id = ${n.id}`;
    await touchProject(tx, n.project_id);
  });
  return json({ ok: true });
});

route("POST", "/api/nodes/:id/move", true, async ({ req, params }, user) => {
  const b = await body(req);
  await sql.begin(async (tx) => {
    const n = await ownNode(user!.id, id(params.id), tx, true);
    let parentId: number | null = n.parent_id;
    if (b.parentId !== undefined && n.kind === "scene") {
      const def = TYPES[n.project_type as ProjectType];
      if (def.container) {
        const parent = await tx`select id from nodes where id = ${Number(b.parentId) || 0} and project_id = ${n.project_id} and kind = ${def.container}`;
        if (!parent.length) throw bad("Can't move it there.");
        parentId = parent[0].id;
      }
    }
    const siblings = parentId === null
      ? await tx`select id, kind from nodes where project_id = ${n.project_id} and parent_id is null and id <> ${n.id} order by position, id`
      : await tx`select id, kind from nodes where parent_id = ${parentId} and id <> ${n.id} order by position, id`;
    // Only reorder among siblings of the same kind (characters with
    // characters, chapters with chapters, scenes with scenes).
    const same = siblings.filter((s: any) => s.kind === n.kind);
    let index = Number(b.index);
    if (!Number.isInteger(index)) index = same.length;
    index = Math.max(0, Math.min(index, same.length));
    same.splice(index, 0, { id: n.id, kind: n.kind });
    let pos = 1;
    for (const s of same) {
      if (s.id === n.id) await tx`update nodes set parent_id = ${parentId}, position = ${pos} where id = ${s.id}`;
      else await tx`update nodes set position = ${pos} where id = ${s.id}`;
      pos++;
    }
    await touchProject(tx, n.project_id);
  });
  return json({ ok: true });
});

// ---- stats & friends

route("GET", "/api/stats", true, async (_c, user) => json(await statsFor(user!)));

function summaryFor(u: any, s: any) {
  return {
    username: u.username, displayName: u.display_name, isPublic: u.is_public,
    stats: s && { todayWords: s.todayWords, streak: s.streak, longestStreak: s.longestStreak, daysMet: s.daysMet, totalWords: s.totalWords, goal: s.goal },
  };
}

route("GET", "/api/friends", true, async (_c, user) => {
  const rows = await sql`
    select u.id, u.username, u.display_name, u.is_public, u.timezone
    from follows f join users u on u.id = f.followee_id
    where f.follower_id = ${user!.id} order by u.display_name`;
  const friends = [];
  for (const u of rows) friends.push(summaryFor(u, u.is_public ? await statsFor(u) : null));
  const followers = await sql`select count(*)::int as c from follows where followee_id = ${user!.id}`;
  return json({ friends, followers: followers[0].c });
});

route("POST", "/api/friends", true, async ({ req }, user) => {
  const b = await body(req);
  const username = str(b.username, 64, "Username").trim().toLowerCase().replace(/^@/, "");
  const r = await sql`select id from users where username = ${username}`;
  if (!r.length) throw new HttpError(404, "No writer by that username.");
  if (r[0].id === user!.id) throw bad("That's you!");
  await sql`insert into follows (follower_id, followee_id) values (${user!.id}, ${r[0].id}) on conflict do nothing`;
  return json({ ok: true }, 201);
});

route("DELETE", "/api/friends/:username", true, async ({ params }, user) => {
  await sql`delete from follows where follower_id = ${user!.id}
            and followee_id = (select id from users where username = ${decodeURIComponent(params.username)})`;
  return json({ ok: true });
});

route("GET", "/api/writers/:username", true, async ({ params }, user) => {
  const r = await sql`select id, username, display_name, is_public, timezone from users where username = ${decodeURIComponent(params.username).toLowerCase()}`;
  if (!r.length) throw notFound();
  const u = r[0];
  const visible = u.is_public || u.id === user!.id;
  const s = visible ? await statsFor(u) : null;
  const following = await sql`select 1 from follows where follower_id = ${user!.id} and followee_id = ${u.id}`;
  return json({ ...summaryFor(u, s), history: s?.history ?? null, today: s?.today ?? null, following: following.length > 0, isMe: u.id === user!.id });
});

// ---------- static files ----------------------------------------------------

const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

async function serveStatic(pathname: string) {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const ext = rel.slice(rel.lastIndexOf("."));
  if (!STATIC_TYPES[ext] || rel.endsWith(".html")) return null;
  const file = Bun.file(join(PUBLIC_DIR, rel));
  if (!(await file.exists())) return null;
  return new Response(file, { headers: { "content-type": STATIC_TYPES[ext], "cache-control": "public, max-age=300" } });
}

async function serveIndex() {
  return new Response(Bun.file(join(PUBLIC_DIR, "index.html")), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
}

// ---------- server ----------------------------------------------------------

export async function handle(req: Request, server: any): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Same-origin check for anything that changes data.
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") || url.host)) {
        throw new HttpError(403, "Cross-site request refused");
      }
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      const user = await currentUser(req);
      if (r.auth && !user) throw new HttpError(401, "Please sign in.");
      return await r.h({ req, url, params, server }, user);
    }
    if (url.pathname.startsWith("/api/")) throw notFound();
    if (req.method === "GET" || req.method === "HEAD") {
      const s = await serveStatic(url.pathname);
      if (s) return s;
      return serveIndex();
    }
    throw notFound();
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on our end." }, 500);
  }
}

if (import.meta.main) {
  await migrate();
  // Tidy expired sessions once an hour.
  setInterval(() => sql`delete from sessions where expires_at < now()`.catch(() => {}), 3600_000);
  Bun.serve({
    port: PORT,
    maxRequestBodySize: 8 * 1024 * 1024,
    fetch: async (req, server) => withSecurity(await handle(req, server)),
  });
  console.log(`500words listening on ${PORT}`);
}
