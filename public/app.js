"use strict";
// 500words — browser app. No AI of any kind lives here: no suggestions,
// completions, rewrites or generated text. Every word is the writer's own.

(() => {
  const GOAL = 500;
  const TYPES = {
    novel: { label: "Novel", container: "chapter", containerLabel: "Chapter", plural: "Novels", spine: "#2f5b4c", blurb: "Chapters and scenes, characters and plot." },
    short_story: { label: "Short story", container: null, plural: "Short stories", spine: "#8a4b2e", blurb: "Scenes in order, with an overview and characters." },
    poem: { label: "Poem", container: null, single: true, plural: "Poems", spine: "#5b4a7a", blurb: "A single page." },
    script: { label: "Movie script", container: "act", containerLabel: "Act", plural: "Movie scripts", spine: "#2e4f6e", blurb: "Acts and scenes, in screenplay type." },
    play: { label: "Play", container: "act", containerLabel: "Act", plural: "Plays", spine: "#7a3b44", blurb: "Acts and scenes, with a cast list." },
    memoir: { label: "Memoir", container: "chapter", containerLabel: "Chapter", plural: "Memoirs", spine: "#4f6b3a", blurb: "Chapters and scenes from your life, with the people in it.", people: true },
    personal_essay: { label: "Personal essay", container: null, single: true, notes: true, plural: "Personal essays", spine: "#9a5a6b", blurb: "One piece, plus a page of notes." },
    article: { label: "Article / essay", container: null, single: true, notes: true, plural: "Articles & essays", spine: "#5a6e78", blurb: "Op-eds, posts, newsletters: one piece plus notes." },
    freeform: { label: "Freeform", container: null, single: true, plural: "Freeform", spine: "#a9864f", blurb: "A single page. Just write — sort it out later." },
  };
  const TYPE_ORDER = ["novel", "memoir", "short_story", "personal_essay", "article", "script", "play", "poem", "freeform"];
  // What a type calls its characters.
  const castWord = (type, one = false) => type === "play" ? "Cast" : TYPES[type].people ? (one ? "Person" : "People") : (one ? "Character" : "Characters");

  // Must match src/words.ts exactly.
  const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu;
  const countWords = (t) => (t ? (t.match(WORD) || []).length : 0);

  // ---------- stored text format (must match src/format.ts) ----------
  // Lines of text with **bold** and _italic_; \ * _ escaped with a backslash.
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const escapeText = (s) => s.replace(/[\\*_]/g, (c) => "\\" + c);
  const BREAK_LINE = /^\s*(?:(?:\*\s*){3,}|(?:#\s*){1,3}|(?:-\s*){3,}|(?:~\s*){3,}|(?:•\s*){3,}|§)\s*$/;
  function parseBody(body) {
    const lines = [];
    let b = false, i = false;
    for (const line of body.split("\n")) {
      const runs = [];
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
  const toPlain = (body) => parseBody(body).map((r) => r.map((x) => x.text).join("")).join("\n");
  const runsToHtml = (runs) => runs.map((r) => {
    let t = escHtml(r.text);
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return t;
  }).join("");
  function storedToHtml(stored) {
    if (!stored) return "";
    return parseBody(stored).map((runs) => `<div>${runsToHtml(runs) || "<br>"}</div>`).join("");
  }
  function runsToStored(runs) {
    return runs.map((r) => {
      const m = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!m[2] || (!r.b && !r.i)) return escapeText(r.text);
      let t = escapeText(m[2]);
      if (r.i) t = `_${t}_`;
      if (r.b) t = `**${t}**`;
      return m[1] + t + m[3];
    }).join("");
  }
  // The editor's DOM (divs, <br>, <b>/<i> and friends) → stored text.
  function serializeEditor(root) {
    const lines = [];
    let cur = [];
    const emit = (text, b, i) => {
      if (!text) return;
      const last = cur[cur.length - 1];
      if (last && last.b === b && last.i === i) last.text += text;
      else cur.push({ text, b, i });
    };
    const newline = () => { lines.push(cur); cur = []; };
    const BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|UL|OL)$/;
    const bold = (el) => el.tagName === "B" || el.tagName === "STRONG" || el.style.fontWeight === "bold" || Number(el.style.fontWeight) >= 600;
    const ital = (el) => el.tagName === "I" || el.tagName === "EM" || el.style.fontStyle === "italic";
    const hasFollowing = (n) => { for (let s = n.nextSibling; s; s = s.nextSibling) if (s.nodeType === 1 || (s.nodeType === 3 && s.data !== "")) return true; return false; };
    function walk(node, b, i) {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          const parts = ch.data.replace(/ /g, " ").split("\n");
          parts.forEach((p, k) => { if (k > 0) newline(); emit(p, b, i); });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === "BR") {
            // A <br> that ends its block is just a placeholder for the line.
            if (hasFollowing(ch) || node === root) newline();
          } else if (BLOCK.test(ch.tagName)) {
            if (cur.length) newline();
            const before = lines.length;
            walk(ch, b || bold(ch), i || ital(ch));
            if (cur.length || lines.length === before) newline();
          } else {
            walk(ch, b || bold(ch), i || ital(ch));
          }
        }
      }
    }
    walk(root, false, false);
    if (cur.length) newline();
    // Trailing <br> at the root's very end leaves an extra empty line.
    while (lines.length && !lines[lines.length - 1].length && root.lastChild && root.lastChild.nodeName === "BR") { lines.pop(); break; }
    return lines.map(runsToStored).join("\n").replace(/\n+$/, "");
  }

  const state = { me: null, todayWords: 0, focus: false };
  const app = document.getElementById("app");
  let cleanup = []; // functions to run when leaving a view
  let leaveGuard = null; // async fn that must finish before navigating

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElementNS(tag === "svg" || tag === "path" || tag === "circle" || tag === "polyline" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "class") el.setAttribute("class", v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (k === "html") el.innerHTML = v;
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const icon = (d, size = 20) => {
    const s = h("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" });
    for (const p of d.split("|")) s.append(h("path", { d: p }));
    return s;
  };
  const ICONS = {
    lamp: "M9 2h6l3 8H6z|M12 10v8|M8 22h8|M12 18v4",
    more: "M5 12h.01|M12 12h.01|M19 12h.01",
    plus: "M12 5v14|M5 12h14",
    menu: "M4 6h16|M4 12h16|M4 18h16",
    focus: "M4 9V4h5|M20 9V4h-5|M4 15v5h5|M20 15v5h-5",
    close: "M6 6l12 12|M18 6L6 18",
    chev: "M6 9l6 6 6-6",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z|M4 21V5",
  };

  // ---------- utilities ----------
  async function api(method, path, data) {
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (data !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(data);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new Error("Can't reach 500words. Check your connection.");
    }
    let out = {};
    try { out = await res.json(); } catch {}
    if (res.status === 401 && path !== "/api/login" && !path.startsWith("/api/me/")) {
      state.me = null;
      go("/", true);
    }
    if (!res.ok) {
      const e = new Error(out.error || "Something went wrong.");
      e.status = res.status;
      throw e;
    }
    return out;
  }

  function toast(msg, err = false) {
    const t = h("div", { class: "toast" + (err ? " err" : "") }, msg);
    document.getElementById("toasts").append(t);
    setTimeout(() => t.remove(), err ? 5000 : 3000);
  }

  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || one + "s"}`;
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    const d = Math.floor(s / 86400);
    if (d === 1) return "yesterday";
    if (d < 30) return `${d} days ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  function tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/New_York"; }
  }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch { return null; }
  }
  function debounce(fn, ms) {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  }
  function autosize(ta) {
    const y = window.scrollY;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    window.scrollTo(0, y);
  }
  // Turn off browser writing aids that generate text. Spell-check stays on.
  function noAI(el) {
    el.setAttribute("writingsuggestions", "false");
    el.setAttribute("autocomplete", "off");
    el.setAttribute("data-gramm", "false");
    el.setAttribute("data-gramm_editor", "false");
    el.setAttribute("data-enable-grammarly", "false");
    el.setAttribute("data-lt-active", "false");
    return el;
  }

  // ---------- theme ----------
  function applyTheme() {
    document.documentElement.dataset.theme = store("w5-theme") === "night" ? "night" : "day";
  }
  function toggleTheme() {
    store("w5-theme", store("w5-theme") === "night" ? "day" : "night");
    applyTheme();
  }
  applyTheme();

  // ---------- modal ----------
  function modal(build) {
    return new Promise((resolve) => {
      const close = (v) => { scrim.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") close(null); };
      const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" });
      const scrim = h("div", { class: "scrim", onmousedown: (e) => { if (e.target === scrim) close(null); } }, box);
      build(box, close);
      document.body.append(scrim);
      document.addEventListener("keydown", onKey);
      const f = box.querySelector("[autofocus]") || box.querySelector("input, textarea, button.primary");
      if (f) setTimeout(() => f.focus(), 20);
    });
  }
  function confirmBox(title, text, okLabel = "OK", danger = false) {
    return modal((box, close) => {
      box.append(
        h("h2", null, title),
        h("p", { class: "muted" }, text),
        h("div", { class: "actions" },
          h("button", { class: "btn ghost", onclick: () => close(false) }, "Cancel"),
          h("button", { class: "btn " + (danger ? "danger solid" : "primary"), onclick: () => close(true) }, okLabel)),
      );
    });
  }

  // ---------- popup menu ----------
  function popMenu(anchor, items) {
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    const menu = h("div", { class: "menu" });
    for (const it of items) {
      if (it === "-") menu.append(h("div", { class: "sep" }));
      else if (it.label && !it.onClick) menu.append(h("div", { class: "label" }, it.label));
      else menu.append(h("button", { class: it.danger ? "danger" : "", onclick: () => { menu.remove(); it.onClick(); } }, it.text));
    }
    anchor.parentElement.append(menu);
    const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener("mousedown", off); } };
    setTimeout(() => document.addEventListener("mousedown", off), 0);
  }

  // ---------- drag to reorder (mouse and touch) ----------
  function grip(onStart, extra = "") {
    return h("span", {
      class: "grip " + extra, title: "Drag to move", "aria-hidden": "true",
      onpointerdown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); onStart(e); },
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); },
    }, "⋮⋮");
  }
  // findTarget(x, y) → { where, line: { left, top, width } } or null.
  // longPress: for touch on a whole row — hold still ~0.35s to pick it up,
  // so a normal swipe still scrolls.
  function startDrag(e, { source, findTarget, onDrop, scroller, longPress = false }) {
    const sx = e.clientX, sy = e.clientY;
    let rect = source.getBoundingClientRect();
    let started = false, ghost = null, line = null, target = null, lastY = sy, frame = 0, timer = 0;
    const begin = () => {
      if (started) return;
      started = true;
      rect = source.getBoundingClientRect();
      try { navigator.vibrate && navigator.vibrate(10); } catch {}
      ghost = source.cloneNode(true);
      ghost.removeAttribute("style");
      ghost.classList.add("drag-ghost");
      Object.assign(ghost.style, { width: rect.width + "px", left: rect.left + "px", top: rect.top + "px" });
      line = h("div", { class: "drop-line" });
      document.body.append(ghost, line);
      source.classList.add("dragging");
      document.body.classList.add("is-dragging");
      const tick = () => {
        const edge = 48, speed = 10;
        if (scroller) {
          const r = scroller.getBoundingClientRect();
          if (lastY < r.top + edge) scroller.scrollTop -= speed;
          else if (lastY > r.bottom - edge) scroller.scrollTop += speed;
        }
        if (lastY < edge) window.scrollBy(0, -speed);
        else if (lastY > window.innerHeight - edge) window.scrollBy(0, speed);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const onMove = (ev) => {
      if (!started) {
        const moved = Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy);
        if (longPress) { if (moved > 8) finish(true); return; }
        if (moved < 5) return;
        begin();
      }
      ev.preventDefault();
      lastY = ev.clientY;
      ghost.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
      target = findTarget(ev.clientX, ev.clientY);
      if (target) Object.assign(line.style, { display: "block", left: target.line.left + "px", top: target.line.top - 1 + "px", width: target.line.width + "px" });
      else line.style.display = "none";
    };
    const onTouchMove = (ev) => { if (started) ev.preventDefault(); };
    const onContext = (ev) => { if (started || longPress) ev.preventDefault(); };
    const finish = (cancel) => {
      clearTimeout(timer);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      if (!started) return;
      ghost.remove(); line.remove();
      source.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      // The pointerup may turn into a click on whatever is underneath; swallow it.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 50);
      if (!cancel && target) onDrop(target.where);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(true); } };
    if (longPress) timer = setTimeout(begin, 350);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  }

  // ---------- routing ----------
  async function go(path, replace = false) {
    if (leaveGuard) { try { await leaveGuard(); } catch {} }
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    render();
  }
  window.addEventListener("popstate", async () => {
    if (leaveGuard) { try { await leaveGuard(); } catch {} }
    render();
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(a.getAttribute("href"));
  });
  const link = (href, attrs, ...kids) => h("a", { href, "data-link": true, ...attrs }, ...kids);

  function setFocus(on) {
    state.focus = on;
    document.body.classList.toggle("focus", on);
  }

  async function render() {
    cleanup.forEach((f) => { try { f(); } catch {} });
    cleanup = [];
    leaveGuard = null;
    setFocus(false);
    document.querySelectorAll(".scrim").forEach((s) => s.remove());
    const path = location.pathname;
    if (path === "/reset") return renderReset();
    if (path.startsWith("/s/")) return renderShared(path.slice(3));
    if (!state.me) {
      if (path.startsWith("/w/")) store("w5-after", path);
      if (path !== "/") history.replaceState(null, "", "/");
      return renderWelcome();
    }
    window.scrollTo(0, 0);
    let m;
    try {
      if (path === "/" || path === "/desk") return await renderDesk();
      if ((m = path.match(/^\/p\/(\d+)\/read$/))) return await renderManuscript(+m[1]);
      if ((m = path.match(/^\/p\/(\d+)(?:\/(\d+))?$/))) return await renderProject(+m[1], m[2] ? +m[2] : null);
      if (path === "/stats") return await renderStats();
      if (path === "/friends") return await renderFriends();
      if ((m = path.match(/^\/w\/([a-z0-9_]+)$/))) return await renderWriter(m[1]);
      if (path === "/settings") return renderSettings();
      shell(h("div", { class: "page narrow" }, h("h1", null, "Not on the shelves"), h("p", { class: "muted" }, "That page doesn't exist. ", link("/", null, "Back to your desk"), ".")));
    } catch (e) {
      if (e.status === 404) {
        shell(h("div", { class: "page narrow" }, h("h1", null, "Not on the shelves"), h("p", { class: "muted" }, "We couldn't find that. ", link("/", null, "Back to your desk"), ".")));
      } else {
        shell(h("div", { class: "page narrow" }, h("h1", null, "Hmm."), h("p", { class: "muted" }, e.message)));
      }
    }
  }

  // ---------- chrome ----------
  let meterEl = null;
  function meter() {
    const fill = h("div", { class: "fill" });
    const num = h("span", { class: "num" });
    const el = link("/stats", { class: "meter", title: "Today's words" }, h("div", { class: "bar" }, fill), num);
    el._fill = fill;
    el._num = num;
    meterEl = el;
    updateMeter(state.todayWords);
    return el;
  }
  function updateMeter(words) {
    state.todayWords = words;
    if (meterEl) {
      meterEl._fill.style.width = Math.min(100, (words / GOAL) * 100) + "%";
      meterEl._num.textContent = "";
      meterEl._num.append(fmt(words), h("small", null, ` / ${GOAL} today`));
      meterEl.classList.toggle("done", words >= GOAL);
    }
    const fm = document.querySelector(".focus-meter");
    if (fm) fm.textContent = `${fmt(words)} / ${GOAL}`;
  }
  async function refreshToday() {
    try {
      const s = await api("GET", "/api/stats");
      updateMeter(s.todayWords);
      return s;
    } catch { return null; }
  }

  function topbar(extra) {
    const p = location.pathname;
    const on = (x) => (x === "/" ? p === "/" || p.startsWith("/p/") : p.startsWith(x)) ? "on" : null;
    return h("header", { class: "topbar" },
      extra,
      link("/", { class: "wordmark" }, h("b", null, "500"), "words"),
      h("nav", { class: "topnav" },
        link("/", { class: on("/") }, "Desk"),
        link("/stats", { class: on("/stats") }, "Stats"),
        link("/friends", { class: on("/friends") || (p.startsWith("/w/") ? "on" : null) }, "Friends"),
        link("/settings", { class: on("/settings") }, "Settings")),
      h("div", { class: "spacer" }),
      meter(),
      h("button", { class: "iconbtn", title: "Day / evening lamp", "aria-label": "Switch light", onclick: toggleTheme }, icon(ICONS.lamp)),
    );
  }
  function shell(content, extra) {
    app.replaceChildren(topbar(extra), content);
  }

  // ---------- welcome / sign in ----------
  function renderWelcome() {
    document.title = "500words — a quiet room for your daily 500";
    let mode = "login";
    const err = h("div", { class: "error" });
    const formBox = h("div");
    const tabs = h("div", { class: "tabs" });
    function draw() {
      tabs.replaceChildren(
        h("button", { class: mode === "login" ? "on" : "", onclick: () => { mode = "login"; draw(); } }, "Sign in"),
        h("button", { class: mode === "signup" ? "on" : "", onclick: () => { mode = "signup"; draw(); } }, "Create an account"),
      );
      err.textContent = "";
      const user = h("input", { class: "text", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true, autofocus: true });
      const pass = h("input", { class: "text", type: "password", name: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true });
      const name = h("input", { class: "text", name: "name", autocomplete: "name" });
      const email = h("input", { class: "text", name: "email", type: "email", autocomplete: "email", autocapitalize: "none", spellcheck: "false" });
      const btn = h("button", { class: "btn primary", type: "submit", style: { width: "100%", marginTop: "6px" } }, mode === "login" ? "Sign in" : "Create my account");
      const form = h("form", { class: "stack", onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        err.textContent = "";
        try {
          const data = { username: user.value, password: pass.value, timezone: tz() };
          if (mode === "signup") { data.displayName = name.value; data.email = email.value; }
          const r = await api("POST", mode === "login" ? "/api/login" : "/api/signup", data);
          state.me = r.user;
          await refreshToday();
          const after = store("w5-after");
          if (after) { store("w5-after", ""); history.replaceState(null, "", after); }
          render();
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
        }
      } },
        mode === "signup" ? h("label", { class: "field" }, h("span", null, "Your name"), name) : null,
        h("label", { class: "field" }, h("span", null, "Username"), user,
          mode === "signup" ? h("div", { class: "hint" }, "Lowercase letters, numbers and underscores. Friends find you by this.") : null),
        h("label", { class: "field" }, h("span", null, "Password"), pass,
          mode === "signup" ? h("div", { class: "hint" }, "At least 8 characters.") : null),
        mode === "signup" ? h("label", { class: "field" }, h("span", null, "Email ", h("span", { class: "faint" }, "(optional)")), email,
          h("div", { class: "hint" }, "Only used to reset your password if you forget it. Without one, a lost password can't be recovered.")) : null,
        err, btn,
        mode === "login" ? h("div", { style: { textAlign: "center", marginTop: "14px" } },
          h("button", { type: "button", class: "btn ghost small", onclick: () => forgotPassword(user.value) }, "Forgot your password?")) : null);
      formBox.replaceChildren(form);
      setTimeout(() => (mode === "signup" ? name : user).focus(), 10);
    }
    draw();
    const books = ["#2f5b4c", "#8a4b2e", "#a9864f", "#5b4a7a", "#2e4f6e", "#7a3b44", "#6b5d52", "#2f5b4c", "#a9864f", "#8a4b2e", "#2e4f6e"];
    app.replaceChildren(h("div", { class: "welcome" },
      h("div", { class: "left" },
        h("div", { class: "wordmark" }, h("b", null, "500"), "words"),
        h("div", { class: "pitch" },
          h("h1", null, "A quiet room for your daily five hundred."),
          h("p", null, "Keep your novels, stories, scripts, plays and poems in order, drop straight into the scene you feel like writing, and watch the day's words add up."),
          h("div", { class: "promise" }, "No AI writes here. Not a word, not a suggestion. Every sentence in 500words is yours."),
          h("div", { class: "shelf-art", "aria-hidden": "true" }, books.map((c, i) => h("i", { style: { background: c, height: 50 + ((i * 37) % 34) + "px" } })))),
      ),
      h("div", { class: "right" }, h("div", { class: "auth" }, tabs, formBox)),
    ));
  }

  // ---------- password reset ----------
  async function forgotPassword(prefill) {
    await modal((box, close) => {
      const who = h("input", { class: "text", value: prefill || "", autocapitalize: "none", spellcheck: "false", autocomplete: "username", autofocus: true });
      const err = h("div", { class: "error" });
      const btn = h("button", { class: "btn primary" }, "Send me a link");
      const form = h("form", { onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        btn.disabled = true;
        try {
          await api("POST", "/api/password/forgot", { who: who.value });
          form.replaceChildren(
            h("h2", null, "Check your email"),
            h("p", { class: "muted" }, "If that account has an email address on file, a link to choose a new password is on its way. It works once, for one hour. Look in spam if it doesn't turn up in a few minutes."),
            h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", onclick: () => close(true) }, "OK")));
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      } },
        h("h2", null, "Forgot your password?"),
        h("p", { class: "muted" }, "Enter your username or the email on your account and we'll send you a link to choose a new one."),
        h("label", { class: "field" }, h("span", null, "Username or email"), who),
        err,
        h("p", { class: "faint", style: { fontSize: "14px" } }, "No email on your account? Then it can't be reset by email — ask the person who invited you."),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "Cancel"), btn));
      box.append(form);
    });
  }

  async function renderReset() {
    document.title = "Choose a new password · 500words";
    const token = new URLSearchParams(location.search).get("token") || "";
    const card = h("div", { class: "auth" });
    app.replaceChildren(h("div", { class: "welcome" },
      h("div", { class: "left" }, h("div", { class: "wordmark" }, h("b", null, "500"), "words"),
        h("div", { class: "pitch" }, h("h1", null, "Back to the desk."), h("p", null, "Choose a new password and you'll be signed straight in."))),
      h("div", { class: "right" }, card)));
    let who;
    try {
      who = await api("GET", `/api/password/reset?token=${encodeURIComponent(token)}`);
    } catch (e) {
      card.replaceChildren(h("h2", null, "That link has run out"), h("p", { class: "muted" }, e.message),
        h("button", { class: "btn primary", onclick: () => { history.replaceState(null, "", "/"); render(); } }, "Back to sign in"));
      return;
    }
    const pass = h("input", { class: "text", type: "password", autocomplete: "new-password", autofocus: true });
    const pass2 = h("input", { class: "text", type: "password", autocomplete: "new-password" });
    const err = h("div", { class: "error" });
    const btn = h("button", { class: "btn primary", style: { width: "100%" } }, "Save and sign in");
    card.replaceChildren(h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (pass.value !== pass2.value) { err.textContent = "Those two passwords don't match."; return; }
      btn.disabled = true;
      try {
        const r = await api("POST", "/api/password/reset", { token, password: pass.value });
        state.me = r.user;
        await refreshToday();
        history.replaceState(null, "", "/");
        toast("Password changed. Welcome back.");
        render();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
      h("h2", null, `New password for @${who.username}`),
      h("label", { class: "field" }, h("span", null, "New password"), pass, h("div", { class: "hint" }, "At least 8 characters.")),
      h("label", { class: "field" }, h("span", null, "Type it again"), pass2),
      err, btn));
    setTimeout(() => pass.focus(), 20);
  }

  // ---------- import ----------
  async function importFlow() {
    const result = await modal((box, close) => {
      box.style.maxWidth = "640px";
      let mode = "file";
      let parsed = null;
      let type = null;
      const err = h("div", { class: "error" });

      function step1() {
        err.textContent = "";
        const tabs = h("div", { class: "tabs" },
          h("button", { type: "button", class: mode === "file" ? "on" : "", onclick: () => { mode = "file"; step1(); } }, "Word or text file"),
          h("button", { type: "button", class: mode === "google" ? "on" : "", onclick: () => { mode = "google"; step1(); } }, "Google Doc"));
        let body;
        const busy = h("div", { class: "faint", style: { minHeight: "1.5em", fontSize: "15px" } });
        const send = async (payload) => {
          err.textContent = "";
          busy.textContent = "Reading your document…";
          try {
            let res;
            if (payload instanceof FormData) {
              const r = await fetch("/api/import/parse", { method: "POST", body: payload, credentials: "same-origin" });
              res = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(res.error || "We couldn't read that file.");
            } else {
              res = await api("POST", "/api/import/parse", payload);
            }
            parsed = res;
            type = res.suggestedType;
            step2();
          } catch (ex) { err.textContent = ex.message; busy.textContent = ""; }
        };
        if (mode === "file") {
          const input = h("input", { type: "file", accept: ".docx,.txt,.md,.markdown", style: { display: "none" }, onchange: () => { if (input.files[0]) { const f = new FormData(); f.append("file", input.files[0]); send(f); } } });
          const drop = h("div", { class: "dropzone", tabindex: "0", role: "button",
            onclick: () => input.click(),
            onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } },
            ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); },
            ondragleave: () => drop.classList.remove("over"),
            ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); const file = e.dataTransfer.files[0]; if (file) { const f = new FormData(); f.append("file", file); send(f); } } },
            h("b", null, "Choose a file"), h("span", null, " or drop it here"),
            h("div", { class: "faint", style: { fontSize: "14px", marginTop: "6px" } }, "Word (.docx), plain text (.txt) or Markdown (.md)"));
          body = h("div", null, input, drop,
            h("p", { class: "faint", style: { fontSize: "14px" } }, "From Google Docs you can also use File → Download → Microsoft Word (.docx) and upload that."));
        } else {
          const url = h("input", { class: "text", type: "url", placeholder: "https://docs.google.com/document/d/…", autofocus: true });
          body = h("form", { onsubmit: (e) => { e.preventDefault(); send({ url: url.value }); } },
            h("label", { class: "field" }, h("span", null, "Link to your Google Doc"), url),
            h("p", { class: "faint", style: { fontSize: "14px" } }, "The doc needs to be shared as “Anyone with the link can view” (Share → General access) so 500words can read it. You can switch sharing back off once it's imported."),
            h("button", { class: "btn primary" }, "Read the doc"));
          setTimeout(() => url.focus(), 20);
        }
        box.replaceChildren(h("h2", null, "Import your writing"), tabs, body, busy, err,
          h("div", { class: "actions" }, h("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "Cancel")));
      }

      function step2() {
        err.textContent = "";
        const title = noAI(h("input", { class: "text", value: parsed.title, maxlength: 200 }));
        const opts = h("div", { class: "types" });
        const preview = h("div", { class: "import-preview" });
        const go = h("button", { class: "btn primary" }, "Import");
        const drawTypes = () => opts.replaceChildren(...TYPE_ORDER.map((t) =>
          h("button", { type: "button", class: "type-opt" + (t === type ? " on" : ""), style: { "--spine": TYPES[t].spine }, onclick: () => { type = t; drawTypes(); drawPreview(); } },
            h("b", null, TYPES[t].label), h("span", null, TYPES[t].blurb))));
        let seq = 0;
        async function drawPreview() {
          const mine = ++seq;
          preview.replaceChildren(h("div", { class: "faint" }, "…"));
          try {
            const p = await api("POST", "/api/import/preview", { type, blocks: parsed.blocks });
            if (mine !== seq) return;
            const def = TYPES[type];
            const sceneLine = (s, i) => h("li", null, h("span", null, s.title), h("span", { class: "faint" }, s.words ? fmt(s.words) : "empty"));
            let list;
            if (p.kind === "page") list = h("p", { class: "muted" }, `One page, ${plural(p.words, "word")}.`);
            else if (p.kind === "scenes") list = h("ol", null, p.scenes.map(sceneLine));
            else list = h("div", null, p.containers.map((c) => h("div", { class: "pv-c" }, h("div", { class: "pv-ct" }, c.title), h("ol", null, c.scenes.map(sceneLine)))));
            const summary = p.kind === "page" ? "" : p.kind === "scenes" ? `${plural(p.scenes.length, "scene")} · ${plural(p.words, "word")}` :
              `${plural(p.containers.length, def.containerLabel.toLowerCase())} · ${plural(p.containers.reduce((a, c) => a + c.scenes.length, 0), "scene")} · ${plural(p.words, "word")}`;
            preview.replaceChildren(summary ? h("div", { class: "label", style: { marginBottom: "8px" } }, summary) : null, list);
          } catch (ex) { preview.replaceChildren(h("div", { class: "error" }, ex.message)); }
        }
        drawTypes();
        drawPreview();
        go.addEventListener("click", async () => {
          go.disabled = true;
          err.textContent = "";
          try {
            const r = await api("POST", "/api/import", { type, title: title.value, blocks: parsed.blocks });
            close(r.project);
          } catch (ex) { err.textContent = ex.message; go.disabled = false; }
        });
        const how = parsed.headings
          ? "Headings become chapters (or acts) and scenes; * * * breaks start new scenes."
          : parsed.breaks ? "Scene breaks (* * *) start new scenes." : "No headings or scene breaks were found, so it comes in as one piece.";
        box.replaceChildren(
          h("h2", null, "How should it come in?"),
          h("p", { class: "muted", style: { fontSize: "15px", marginTop: "-6px" } }, `Found ${plural(parsed.words, "word")}. ${how}`),
          h("label", { class: "field" }, h("span", null, "Title"), title),
          h("div", { style: { height: "14px" } }), opts,
          h("div", { class: "label", style: { margin: "18px 0 8px" } }, "Preview"), preview,
          h("p", { class: "faint", style: { fontSize: "14px" } }, "Imported words are already written, so they don't count toward today's 500. You can rename, reorder or merge scenes afterward."),
          err,
          h("div", { class: "actions" }, h("button", { type: "button", class: "btn ghost", onclick: step1 }, "Back"), go));
      }
      step1();
    });
    if (result) { toast("Imported."); go(`/p/${result.id}`); }
  }

  // ---------- desk ----------
  async function renderDesk() {
    document.title = "Desk · 500words";
    const [{ projects }, stats] = await Promise.all([api("GET", "/api/projects"), api("GET", "/api/stats")]);
    updateMeter(stats.todayWords);
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const first = (state.me.displayName || state.me.username).split(" ")[0];

    const left = Math.max(0, GOAL - stats.todayWords);
    const pct = Math.min(1, stats.todayWords / GOAL);
    const R = 52, C = 2 * Math.PI * R;
    const ring = h("div", { class: "ring" },
      h("svg", { viewBox: "0 0 120 120" },
        h("circle", { class: "track", cx: 60, cy: 60, r: R, fill: "none", "stroke-width": 9 }),
        h("circle", { class: "prog", cx: 60, cy: 60, r: R, fill: "none", "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": C, "stroke-dashoffset": C * (1 - pct) })),
      h("div", { class: "in" }, h("b", null, fmt(stats.todayWords)), h("small", null, "today")));
    let line;
    if (stats.todayWords >= GOAL) line = "Today's five hundred are written. Anything more is a gift.";
    else if (stats.todayWords === 0) line = stats.streak > 0 ? `Your ${plural(stats.streak, "day")} streak is waiting on today's pages.` : "The page is blank and the lamp is on. Five hundred words and you're done.";
    else line = `${fmt(left)} to go. You're ${Math.round(pct * 100)}% of the way there.`;

    const todayCard = h("div", { class: "card today-card" }, ring,
      h("div", null,
        h("h2", null, line),
        h("div", { class: "today-stats" },
          h("div", null, h("b", null, fmt(stats.streak)), h("span", { class: "faint" }, stats.streak === 1 ? "day streak" : "day streak")),
          h("div", null, h("b", null, fmt(stats.longestStreak)), h("span", { class: "faint" }, "longest streak")),
          h("div", null, h("b", null, fmt(stats.totalWords)), h("span", { class: "faint" }, "words, all time")))));

    const newBtn = h("button", { class: "btn primary", onclick: () => newProject() }, icon(ICONS.plus, 18), "Begin something new");

    let shelves;
    if (!projects.length) {
      shelves = h("div", { class: "empty-desk" },
        h("h2", null, "Your shelves are empty"),
        h("p", null, "Start a novel, a story, a script or a play — or open a freeform page and just write. You can turn a freeform page into anything later."),
        h("div", { class: "row", style: { justifyContent: "center" } },
          h("button", { class: "btn primary", onclick: () => quickFreeform() }, "Open a freeform page"),
          h("button", { class: "btn", onclick: () => newProject() }, "Start a project"),
          h("button", { class: "btn", onclick: () => importFlow() }, "Import from Word or Google Docs")));
    } else {
      shelves = h("div", null, TYPE_ORDER.filter((t) => projects.some((p) => p.type === t)).map((t) =>
        h("section", { class: "shelf" },
          h("div", { class: "shelf-head" }, h("h2", null, TYPES[t].plural), h("span", { class: "faint" }, fmt(projects.filter((p) => p.type === t).length))),
          h("div", { class: "books" }, projects.filter((p) => p.type === t).map((p) =>
            link(`/p/${p.id}`, { class: "book", style: { "--spine": TYPES[t].spine } },
              h("div", { class: "label" }, TYPES[t].label),
              h("h3", null, p.title),
              h("div", { class: "meta" }, plural(p.words, "word"),
                TYPES[t].container ? ` · ${plural(p.containers, TYPES[t].container)}` : !TYPES[t].single && p.scenes ? ` · ${plural(p.scenes, "scene")}` : "",
                h("br"), "Touched ", ago(p.updatedAt))))))));
    }

    shell(h("div", { class: "page" },
      h("div", { class: "desk-head" },
        h("div", null, h("div", { class: "label" }, new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })),
          h("h1", null, `${greet}, ${first}.`)),
        h("div", { class: "row wrap" }, projects.length ? [h("button", { class: "btn", onclick: () => importFlow() }, "Import"), h("button", { class: "btn", onclick: () => quickFreeform() }, "Freeform page")] : null, newBtn)),
      todayCard,
      shelves));
  }

  async function quickFreeform() {
    const title = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    try {
      const r = await api("POST", "/api/projects", { type: "freeform", title });
      go(`/p/${r.project.id}`);
    } catch (e) { toast(e.message, true); }
  }

  async function newProject() {
    const result = await modal((box, close) => {
      let type = "novel";
      const opts = h("div", { class: "types" });
      const title = h("input", { class: "text", placeholder: "Working title", maxlength: 200, autofocus: true });
      noAI(title);
      const err = h("div", { class: "error" });
      const draw = () => opts.replaceChildren(...TYPE_ORDER.map((t) =>
        h("button", { type: "button", class: "type-opt" + (t === type ? " on" : ""), style: { "--spine": TYPES[t].spine }, onclick: () => { type = t; draw(); } },
          h("b", null, TYPES[t].label), h("span", null, TYPES[t].blurb))));
      draw();
      const submit = async (e) => {
        e && e.preventDefault();
        try {
          const r = await api("POST", "/api/projects", { type, title: title.value });
          close(r.project);
        } catch (ex) { err.textContent = ex.message; }
      };
      box.append(h("form", { onsubmit: submit },
        h("h2", null, "Begin something new"),
        opts,
        h("label", { class: "field", style: { marginTop: "18px" } }, h("span", null, "Title"), title),
        err,
        h("div", { class: "actions" },
          h("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "Cancel"),
          h("button", { type: "submit", class: "btn primary" }, "Start writing"))));
    });
    if (result) go(`/p/${result.id}`);
  }

  // ---------- project (writing room) ----------
  async function renderProject(pid, nodeId) {
    const data = await api("GET", `/api/projects/${pid}`);
    const project = data.project;
    let nodes = data.nodes;
    const def = TYPES[project.type];
    document.title = `${project.title} · 500words`;

    const byId = () => new Map(nodes.map((n) => [n.id, n]));
    const sorted = (list) => list.slice().sort((a, b) => a.position - b.position || a.id - b.id);
    const kids = (pid) => sorted(nodes.filter((n) => n.parentId === pid));
    const top = (kind) => sorted(nodes.filter((n) => n.parentId === null && n.kind === kind));

    // Choose the node to open.
    if (def.single) {
      const notesNode = def.notes ? nodes.find((n) => n.kind === "overview") : null;
      if (!(notesNode && nodeId === notesNode.id)) {
        const page = nodes.find((n) => n.kind === "page");
        nodeId = page ? page.id : null;
      }
    } else if (!nodeId || !byId().has(nodeId)) {
      const last = Number(store(`w5-last-${pid}`));
      if (last && byId().has(last)) nodeId = last;
      else {
        const firstScene = sorted(nodes.filter((n) => n.kind === "scene")).find((n) => n.words === 0) || nodes.find((n) => n.kind === "overview");
        nodeId = firstScene ? firstScene.id : nodes[0]?.id;
      }
      history.replaceState(null, "", `/p/${pid}/${nodeId}`);
    }
    store(`w5-last-${pid}`, String(nodeId));

    const collapsed = new Set(JSON.parse(store(`w5-collapsed-${pid}`) || "[]"));
    const rail = h("aside", { class: "rail" });
    const pane = h("main", { class: "desk-pane" });
    let railScrim = null;
    const openRail = () => {
      rail.classList.add("open");
      railScrim = h("div", { class: "rail-scrim", onclick: closeRail });
      document.body.append(railScrim);
    };
    function closeRail() { rail.classList.remove("open"); railScrim && railScrim.remove(); railScrim = null; }
    cleanup.push(closeRail);

    async function reload() {
      const d = await api("GET", `/api/projects/${pid}`);
      nodes = d.nodes;
      project.title = d.project.title;
      drawRail();
    }

    function select(id) {
      closeRail();
      go(`/p/${pid}/${id}`);
    }

    function railItem(n, cls = "") {
      const isLeaf = n.kind === "scene";
      const movable = n.kind === "scene" || n.kind === "character";
      const el = h("button", { class: `rail-item ${cls}${n.id === nodeId ? " on" : ""}${movable ? " movable" : ""}`, onclick: () => select(n.id), title: n.summary || n.title,
        "data-node": n.id, "data-kind": n.kind, "data-parent": n.parentId ?? "",
        onpointerdown: movable ? (e) => rowDown(e, n, el) : null },
        movable ? grip((e) => railDrag(e, n, el)) : null,
        isLeaf ? h("span", { class: "dot" + (n.words > 0 ? " full" : "") }) : null,
        h("span", { class: "t" }, n.title || "Untitled"),
        n.words ? h("span", { class: "w" }, fmt(n.words)) : null);
      return el;
    }

    // Same-kind siblings, in order.
    const siblingsOf = (kind, parentId) => (parentId === null ? top(kind) : kids(parentId).filter((k) => k.kind === kind));

    function dropMove(n, where) {
      const cur = siblingsOf(n.kind, n.parentId).map((x) => x.id).indexOf(n.id);
      const sameParent = where.parentId === undefined || where.parentId === n.parentId;
      if (sameParent && where.index === cur) return Promise.resolve(false);
      return move(n, where).then(() => true);
    }

    // Press-and-drag anywhere on a row (mouse), or press-and-hold (touch).
    function rowDown(e, n, el) {
      if (e.button !== 0 || e.target.closest(".grip")) return;
      railDrag(e, n, el, e.pointerType !== "mouse");
    }

    function railDrag(e, n, sourceEl, longPress = false) {
      const kind = n.kind;
      const lineAt = (top) => { const rr = rail.getBoundingClientRect(); return { left: rr.left + 10, top, width: rr.width - 20 }; };
      const rowTarget = (row, x, y) => {
        const id = Number(row.dataset.node);
        if (id === n.id) return null;
        const parent = row.dataset.parent === "" ? null : Number(row.dataset.parent);
        const r = row.getBoundingClientRect();
        const before = y < r.top + r.height / 2;
        const sibs = siblingsOf(kind, parent).filter((s) => s.id !== n.id).map((s) => s.id);
        const where = { index: sibs.indexOf(id) + (before ? 0 : 1) };
        if (kind === "scene" && def.container) where.parentId = parent;
        return { where, line: lineAt(before ? r.top : r.bottom) };
      };
      startDrag(e, {
        source: sourceEl, scroller: rail, longPress,
        onDrop: (where) => dropMove(n, where).catch(() => {}),
        findTarget: (x, y) => {
          const el = document.elementFromPoint(x, y);
          if (!el || !rail.contains(el)) return null;
          if (kind === "chapter" || kind === "act") {
            const block = el.closest("[data-block]");
            if (!block) return null;
            const bid = Number(block.dataset.block);
            if (bid === n.id) return null;
            const r = block.getBoundingClientRect();
            const before = y < r.top + r.height / 2;
            const ids = top(kind).filter((c) => c.id !== n.id).map((c) => c.id);
            return { where: { index: ids.indexOf(bid) + (before ? 0 : 1) }, line: lineAt(before ? r.top : r.bottom) };
          }
          const row = el.closest(`[data-kind="${kind}"][data-node]`);
          if (row) return rowTarget(row, x, y);
          if (kind === "scene" && def.container) {
            // Dropped on a chapter heading (goes first) or its "+ Scene" link / a collapsed chapter (goes last).
            const block = el.closest("[data-block]");
            if (!block) return null;
            const cid = Number(block.dataset.block);
            const count = kids(cid).filter((s) => s.kind === "scene" && s.id !== n.id).length;
            const onHead = el.closest(".chapter-head");
            if (onHead && !collapsed.has(cid)) return { where: { parentId: cid, index: 0 }, line: lineAt(onHead.getBoundingClientRect().bottom) };
            const addBtn = block.querySelector(".add-link");
            const at = addBtn ? addBtn.getBoundingClientRect().top : block.getBoundingClientRect().bottom;
            return { where: { parentId: cid, index: count }, line: lineAt(at) };
          }
          return null;
        },
      });
    }

    async function addNode(kind, parentId) {
      try {
        const r = await api("POST", `/api/projects/${pid}/nodes`, { kind, parentId });
        nodes.push(r.node);
        if (parentId) { collapsed.delete(parentId); saveCollapsed(); }
        select(r.node.id);
      } catch (e) { toast(e.message, true); }
    }
    const saveCollapsed = () => store(`w5-collapsed-${pid}`, JSON.stringify([...collapsed]));

    function drawRail() {
      const totalWords = nodes.filter((n) => n.kind === "scene" || n.kind === "page").reduce((s, n) => s + n.words, 0);
      const titleRow = h("div", { class: "rail-title" },
        h("div", { class: "label" }, def.label),
        h("h2", null, project.title),
        h("div", { class: "row" },
          h("span", { class: "faint", style: { fontSize: "14px" } }, plural(totalWords, "word")),
          h("div", { class: "menu-wrap" }, h("button", { class: "iconbtn", title: "Project options", "aria-label": "Project options", onclick: (e) => projectMenu(e.currentTarget) }, icon(ICONS.more)))));

      const plan = h("div", { class: "rail-group" },
        h("div", { class: "head" }, h("span", { class: "label" }, "Plan")),
        top("overview").map((n) => railItem(n)),
        h("div", { class: "head", style: { marginTop: "8px" } },
          h("span", { class: "label" }, castWord(project.type)),
          h("button", { class: "add-link", onclick: () => addNode("character") }, "+ Add")),
        top("character").map((n) => railItem(n)),
        top("character").length ? null : h("div", { class: "faint", style: { fontSize: "14px", padding: "2px 8px" } }, "No one yet."));

      let manuscript;
      if (def.container) {
        const containers = top(def.container);
        manuscript = h("div", { class: "rail-group" },
          h("div", { class: "head" }, h("span", { class: "label" }, def.containerLabel + "s & scenes"),
            h("button", { class: "add-link", onclick: () => addNode(def.container) }, `+ ${def.containerLabel}`)),
          containers.map((c) => {
            const isC = collapsed.has(c.id);
            const scenes = kids(c.id);
            const words = scenes.reduce((s, n) => s + n.words, 0);
            const head = h("div", { class: "row chapter-head", style: { gap: "0" } },
              h("button", { class: "iconbtn", style: { padding: "4px" }, title: isC ? "Expand" : "Collapse", onclick: () => { isC ? collapsed.delete(c.id) : collapsed.add(c.id); saveCollapsed(); drawRail(); } },
                h("span", { class: "twisty" }, icon(ICONS.chev, 14))),
              h("button", { class: `rail-item container movable${c.id === nodeId ? " on" : ""}`, onclick: () => select(c.id), title: c.summary || c.title,
                onpointerdown: (e) => { if (e.button === 0) railDrag(e, c, e.currentTarget.closest(".rail-block"), e.pointerType !== "mouse"); } },
                h("span", { class: "t" }, c.title || "Untitled"), words ? h("span", { class: "w" }, fmt(words)) : null));
            const block = h("div", { class: "rail-block" + (isC ? " collapsed" : ""), "data-block": c.id });
            block.append(grip((e) => railDrag(e, c, block), "block-grip"), head,
              ...(isC ? [] : [...scenes.map((s) => railItem(s, "scene")),
                h("button", { class: "add-link indent", onclick: () => addNode("scene", c.id) }, "+ Scene")]));
            return block;
          }));
      } else {
        manuscript = h("div", { class: "rail-group" },
          h("div", { class: "head" }, h("span", { class: "label" }, "Scenes"), h("button", { class: "add-link", onclick: () => addNode("scene") }, "+ Scene")),
          top("scene").map((s) => railItem(s, "scene top")));
      }
      rail.replaceChildren(titleRow, plan, manuscript,
        h("div", { class: "rail-foot" },
          link(`/p/${pid}/read`, { class: "rail-item" }, icon(ICONS.book, 18), h("span", { class: "t" }, "Read the manuscript")),
          link("/", { class: "rail-item" }, h("span", { class: "t faint" }, "← Back to the desk"))));
    }

    async function projectMenu(anchor) {
      popMenu(anchor, [
        { text: "Rename project", onClick: renameProject },
        { text: "Change type…", onClick: convert },
        { text: "Read, export or download", onClick: () => go(`/p/${pid}/read`) },
        { text: "Share…", onClick: () => shareDialog(pid, project.title) },
        "-",
        { text: "Delete project", danger: true, onClick: deleteProject },
      ]);
    }
    async function renameProject() {
      const t = await modal((box, close) => {
        const inp = noAI(h("input", { class: "text", value: project.title, maxlength: 200, autofocus: true }));
        box.append(h("form", { onsubmit: (e) => { e.preventDefault(); close(inp.value); } },
          h("h2", null, "Rename project"), inp,
          h("div", { class: "actions" }, h("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary" }, "Save"))));
      });
      if (t == null) return;
      try {
        const r = await api("PUT", `/api/projects/${pid}`, { title: t });
        project.title = r.title;
        document.title = `${project.title} · 500words`;
        if (def.single) render(); else drawRail();
      } catch (e) { toast(e.message, true); }
    }
    async function deleteProject() {
      const ok = await confirmBox(`Delete “${project.title}”?`, "This removes the project and all of its writing for good. The words you wrote still count in your stats.", "Delete it", true);
      if (!ok) return;
      leaveGuard = null;
      try { await api("DELETE", `/api/projects/${pid}`); toast("Project deleted."); go("/", true); } catch (e) { toast(e.message, true); }
    }
    async function convert() {
      const target = await modal((box, close) => {
        let pick = null;
        let breaks = true;
        const note = h("p", { class: "muted", style: { fontSize: "15px", minHeight: "3em" } });
        const breakOpt = h("label", { class: "switch", style: { display: "none", marginTop: "4px" } },
          h("input", { type: "checkbox", checked: true, onchange: (e) => { breaks = e.target.checked; if (pick) note.textContent = explain(pick); } }),
          h("span", { class: "knob" }), h("span", { class: "muted", style: { fontSize: "15px" } }, "Put * * * between scenes"));
        const opts = h("div", { class: "types" });
        const ok = h("button", { class: "btn primary", disabled: true, onclick: () => close({ type: pick, breaks }) }, "Change it");
        const explain = (t) => {
          const to = TYPES[t];
          const cast = castWord(project.type).toLowerCase();
          if (to.single && !def.single) return `Every scene is joined, in order, into one page${breaks ? " with a * * * between scenes" : ""}. ` +
            (to.notes ? `Your overview becomes its Notes page; your ${cast} are kept out of sight and come back if you change it again.` : `Your overview and ${cast} are kept out of sight and come back if you change it again.`);
          if (def.single && !to.single && def.notes) return `Your piece becomes the first scene${to.container ? ` of ${to.containerLabel.toLowerCase()} one` : ""}, and your notes become the overview.`;
          if (def.single && !to.single) return to.container ? `Your page becomes the first scene of ${to.containerLabel.toLowerCase()} one, with an overview and characters to fill in.` : "Your page becomes the first scene, with an overview and characters to fill in.";
          if (to.single) return def.notes && !to.notes ? "The page stays exactly as it is; your notes are kept out of sight and come back if you change it again." : "The page stays exactly as it is.";
          if (to.container && def.container && to.container !== def.container) return `Your ${def.containerLabel.toLowerCase()}s become ${to.containerLabel.toLowerCase()}s, scenes and all.`;
          if (to.container && !def.container) return `All your scenes go into ${to.containerLabel} One, in order.`;
          if (!to.container && def.container) return `Scenes stay in reading order; the ${def.containerLabel.toLowerCase()} headings go away.`;
          return "Your scenes, overview and characters all stay as they are.";
        };
        const draw = () => opts.replaceChildren(...TYPE_ORDER.filter((t) => t !== project.type).map((t) =>
          h("button", { type: "button", class: "type-opt" + (t === pick ? " on" : ""), style: { "--spine": TYPES[t].spine }, onclick: () => { pick = t; ok.disabled = false; note.textContent = explain(t); breakOpt.style.display = TYPES[t].single && !def.single ? "" : "none"; draw(); } },
            h("b", null, TYPES[t].label), h("span", null, TYPES[t].blurb))));
        draw();
        box.append(h("h2", null, `Change “${project.title}” to…`), opts, h("div", { style: { marginTop: "14px" } }, note), breakOpt,
          h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"), ok));
      });
      if (!target) return;
      try {
        if (leaveGuard) await leaveGuard();
        await api("POST", `/api/projects/${pid}/convert`, { type: target.type, breaks: target.breaks });
        toast(`It's a ${TYPES[target.type].label.toLowerCase()} now.`);
        store(`w5-last-${pid}`, "");
        leaveGuard = null;
        go(`/p/${pid}`, true);
      } catch (e) { toast(e.message, true); }
    }

    // ----- editor pane -----
    const node = (await api("GET", `/api/nodes/${nodeId}`));
    const n = node.node;
    updateMeter(node.todayWords);
    const parent = n.parentId ? byId().get(n.parentId) : null;

    if (def.single) {
      renderSingle(n, node);
    } else if (n.kind === "chapter" || n.kind === "act") {
      renderContainer(n);
    } else {
      renderScene(n, node);
    }

    function renderContainer(c) {
      const titleIn = noAI(h("input", { class: "title-input", value: c.title, maxlength: 200, placeholder: `${def.containerLabel} title` }));
      const notes = noAI(h("textarea", { class: "notes", placeholder: `What happens in this ${def.containerLabel.toLowerCase()}?`, rows: 3 }));
      notes.value = c.summary;
      const saveC = debounce(async () => {
        try {
          await api("PUT", `/api/nodes/${c.id}`, { title: titleIn.value, summary: notes.value });
          const local = byId().get(c.id);
          if (local) { local.title = titleIn.value; local.summary = notes.value; drawRail(); }
        } catch (e) { toast(e.message, true); }
      }, 700);
      titleIn.addEventListener("input", saveC);
      notes.addEventListener("input", () => { saveC(); autosize(notes); });
      leaveGuard = async () => saveC.cancel() || (await api("PUT", `/api/nodes/${c.id}`, { title: titleIn.value, summary: notes.value }).catch(() => {}));

      const scenes = kids(c.id);
      const cards = h("div", { class: "cards" }, scenes.map((s, i) => {
        const t = noAI(h("input", { value: s.title, maxlength: 200, placeholder: "Scene title" }));
        const sum = noAI(h("textarea", { placeholder: "What happens here? (planning notes — they don't count toward your 500)", rows: 2 }));
        sum.value = s.summary;
        const save = debounce(async () => {
          try {
            await api("PUT", `/api/nodes/${s.id}`, { title: t.value, summary: sum.value });
            s.title = t.value; s.summary = sum.value; drawRail();
          } catch (e) { toast(e.message, true); }
        }, 700);
        t.addEventListener("input", save);
        sum.addEventListener("input", () => { save(); autosize(sum); });
        setTimeout(() => autosize(sum), 0);
        const card = h("div", { class: "index-card", "data-node": s.id });
        card.append(
          h("div", { class: "row" }, grip((e) => cardDrag(e, s, card)), h("span", { class: "faint", style: { fontSize: "14px", width: "22px" } }, i + 1), t,
            h("span", { class: "faint", style: { fontSize: "14px", whiteSpace: "nowrap" } }, s.words ? plural(s.words, "word") : "unwritten"),
            h("button", { class: "btn small", onclick: () => select(s.id) }, s.words ? "Write" : "Start")),
          sum);
        return card;
      }));
      function cardDrag(e, s, card) {
        startDrag(e, {
          source: card,
          onDrop: async (where) => {
            try { if (await dropMove(s, where)) go(location.pathname, true); } catch {}
          },
          findTarget: (x, y) => {
            const el = document.elementFromPoint(x, y);
            const over = el && el.closest(".index-card[data-node]");
            if (!over || !cards.contains(over)) return null;
            const id = Number(over.dataset.node);
            if (id === s.id) return null;
            const r = over.getBoundingClientRect();
            const before = y < r.top + r.height / 2;
            const ids = scenes.filter((x2) => x2.id !== s.id).map((x2) => x2.id);
            const gap = 7;
            return { where: { index: ids.indexOf(id) + (before ? 0 : 1) }, line: { left: r.left, top: before ? r.top - gap : r.bottom + gap, width: r.width } };
          },
        });
      }

      pane.replaceChildren(
        h("div", { class: "row mobile-only", style: { marginBottom: "10px" } }, h("button", { class: "btn small", onclick: openRail }, icon(ICONS.menu, 16), "Contents")),
        h("div", { class: "paper" },
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("div", { class: "crumbs" }, def.containerLabel + " outline"),
            h("div", { class: "menu-wrap" }, h("button", { class: "iconbtn", title: "More", onclick: (e) => nodeMenu(e.currentTarget, c) }, icon(ICONS.more)))),
          titleIn,
          h("div", { class: "label", style: { marginTop: "18px", marginBottom: "6px" } }, `${def.containerLabel} notes`),
          notes,
          h("div", { class: "label", style: { marginTop: "28px" } }, "Scenes — plan them here, write them in any order"),
          cards,
          h("button", { class: "btn", style: { marginTop: "16px" }, onclick: () => addNode("scene", c.id) }, icon(ICONS.plus, 16), "Add a scene")));
      setTimeout(() => autosize(notes), 0);
    }

    function nodeMenu(anchor, nd) {
      const items = [];
      const sibs = nd.parentId === null ? top(nd.kind) : kids(nd.parentId).filter((x) => x.kind === nd.kind);
      const idx = sibs.findIndex((x) => x.id === nd.id);
      if (nd.kind !== "overview" && nd.kind !== "page") {
        if (idx > 0) items.push({ text: "Move up", onClick: () => move(nd, { index: idx - 1 }) });
        if (idx < sibs.length - 1) items.push({ text: "Move down", onClick: () => move(nd, { index: idx + 1 }) });
        if (nd.kind === "scene" && def.container) {
          const others = top(def.container).filter((c) => c.id !== nd.parentId);
          if (others.length) {
            items.push("-", { label: `Move to ${def.containerLabel.toLowerCase()}` });
            for (const c of others) items.push({ text: c.title || "Untitled", onClick: () => move(nd, { parentId: c.id }) });
          }
        }
        items.push("-", { text: `Delete ${nd.kind === "act" || nd.kind === "chapter" ? def.containerLabel.toLowerCase() : nd.kind}`, danger: true, onClick: () => removeNode(nd) });
      }
      items.push("-", { text: "Focus mode", onClick: () => setFocus(true) });
      popMenu(anchor, items);
    }
    async function move(nd, where) {
      try {
        if (leaveGuard) await leaveGuard();
        await api("POST", `/api/nodes/${nd.id}/move`, where);
        await reload();
      } catch (e) { toast(e.message, true); }
    }
    async function removeNode(nd) {
      const isC = nd.kind === "chapter" || nd.kind === "act";
      const what = isC ? `${nd.title || "this " + def.containerLabel.toLowerCase()} and every scene in it` : `“${nd.title || "this " + nd.kind}”`;
      const ok = await confirmBox("Delete for good?", `This removes ${what}. Words you wrote today still count toward your 500.`, "Delete", true);
      if (!ok) return;
      try {
        leaveGuard = null;
        await api("DELETE", `/api/nodes/${nd.id}`);
        store(`w5-last-${pid}`, "");
        go(`/p/${pid}`, true);
      } catch (e) { toast(e.message, true); }
    }

    // A writing surface: title, optional notes, and the body.
    function makeEditor(nd, dayInfo, opts) {
      let baseline = dayInfo.baseline;
      let savedPasted = dayInfo.pasted;
      let pendingPasted = 0;
      let savedContribution = Math.max(0, nd.words - baseline - savedPasted);
      let todayOthers = state.todayWords - savedContribution;
      let dirty = false, saving = null, failed = false;
      const status = h("span", { class: "saved" }, "Saved");
      const countEl = h("span");
      const title = opts.title;
      const notes = opts.notes;
      // A formatted editor: bold and italics only. No AI, no suggestions.
      const body = noAI(h("div", {
        class: "writing" + (project.type === "script" ? " mono" : project.type === "poem" ? " poem" : ""),
        contenteditable: "true", role: "textbox", "aria-multiline": "true", spellcheck: "true",
        "aria-label": "Your writing", "data-placeholder": opts.placeholder,
      }));
      body.innerHTML = storedToHtml(nd.body || "");
      let current = nd.body || "";
      const read = () => (current = serializeEditor(body));

      const live = () => {
        const w = countWords(current);
        const contribution = Math.max(0, w - baseline - savedPasted - pendingPasted);
        updateMeter(todayOthers + contribution);
        countEl.textContent = plural(w, "word");
        body.classList.toggle("empty", !current.trim() && !body.querySelector("b,i"));
        return w;
      };
      const setStatus = () => {
        status.className = "saved" + (failed ? " fail" : dirty ? " dirty" : "");
        status.textContent = failed ? "Not saved — retrying" : dirty ? "Saving…" : "Saved";
      };
      async function save() {
        if (saving) { await saving; }
        if (!dirty) return;
        dirty = false;
        read();
        const sendPasted = pendingPasted;
        const payload = { body: current, pasted: sendPasted };
        if (title) payload.title = title.value;
        if (notes) payload.summary = notes.value;
        saving = (async () => {
          try {
            const r = await api("PUT", `/api/nodes/${nd.id}`, payload);
            pendingPasted -= sendPasted;
            if (r.day) { baseline = r.day.baseline; savedPasted = r.day.pasted; }
            todayOthers = r.todayWords - Math.max(0, r.words - baseline - savedPasted);
            failed = false;
            const local = byId().get(nd.id);
            if (local) {
              local.words = r.words;
              if (title) local.title = title.value;
              if (notes) local.summary = notes.value;
            }
            if (!def.single) drawRail();
          } catch (e) {
            dirty = true;
            failed = true;
            if (e.status && e.status < 500 && e.status !== 429) toast(e.message, true);
            setTimeout(() => dirty && save(), 4000);
          } finally {
            saving = null;
            setStatus();
            live();
          }
        })();
        setStatus();
        await saving;
        if (dirty && !failed) await save();
      }
      const soon = debounce(save, 900);
      let frame = 0;
      const changed = () => {
        dirty = true; setStatus(); soon();
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; read(); live(); });
      };
      body.addEventListener("input", changed);
      body.addEventListener("focus", () => { try { document.execCommand("defaultParagraphSeparator", false, "div"); document.execCommand("styleWithCSS", false, false); } catch {} });

      const countPasted = (text) => {
        const n = countWords(text || "");
        if (!n) return;
        pendingPasted += n;
        if (!store("w5-paste-note")) {
          store("w5-paste-note", "1");
          toast("Pasted words go in your project, but they don't count toward the daily 500.");
        }
      };
      // Paste and drop come in as plain text (formatting from elsewhere is dropped).
      body.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
        if (!text) return;
        countPasted(text);
        document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
      });
      let internalDrag = false;
      body.addEventListener("dragstart", () => { internalDrag = true; });
      body.addEventListener("dragend", () => { internalDrag = false; });
      body.addEventListener("drop", (e) => {
        if (internalDrag) return;
        e.preventDefault();
        const text = e.dataTransfer && e.dataTransfer.getData("text/plain");
        if (!text) return;
        const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY)
          : document.caretPositionFromPoint ? (() => { const p = document.caretPositionFromPoint(e.clientX, e.clientY); const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })() : null;
        if (pos) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(pos); }
        countPasted(text);
        document.execCommand("insertText", false, text);
      });

      const bBtn = h("button", { class: "fmt-btn", title: "Bold (Ctrl/⌘ B)", "aria-label": "Bold", onmousedown: (e) => e.preventDefault(), onclick: () => { body.focus(); document.execCommand("bold"); updateFmt(); } }, h("b", null, "B"));
      const iBtn = h("button", { class: "fmt-btn", title: "Italic (Ctrl/⌘ I)", "aria-label": "Italic", onmousedown: (e) => e.preventDefault(), onclick: () => { body.focus(); document.execCommand("italic"); updateFmt(); } }, h("i", null, "I"));
      function updateFmt() {
        const inside = body.contains(getSelection().anchorNode);
        let b = false, i = false;
        try { b = inside && document.queryCommandState("bold"); i = inside && document.queryCommandState("italic"); } catch {}
        bBtn.classList.toggle("on", !!b);
        iBtn.classList.toggle("on", !!i);
      }
      body.addEventListener("keydown", (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "b" || k === "i") { e.preventDefault(); document.execCommand(k === "b" ? "bold" : "italic"); updateFmt(); }
        else if (k === "u") e.preventDefault(); // underline isn't kept, so don't offer it
      });
      document.addEventListener("selectionchange", updateFmt);
      cleanup.push(() => document.removeEventListener("selectionchange", updateFmt));

      if (title) title.addEventListener("input", changed);
      if (notes) notes.addEventListener("input", () => { autosize(notes); changed(); });

      const flush = async () => { soon.cancel(); await save(); };
      leaveGuard = flush;
      const beforeUnload = (e) => {
        if (!dirty) return;
        read();
        const payload = { body: current, pasted: pendingPasted };
        if (title) payload.title = title.value;
        if (notes) payload.summary = notes.value;
        try {
          fetch(`/api/nodes/${nd.id}`, { method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        } catch {}
        e.preventDefault();
      };
      window.addEventListener("beforeunload", beforeUnload);
      cleanup.push(() => window.removeEventListener("beforeunload", beforeUnload));
      const onVis = () => { if (document.visibilityState === "hidden") flush(); };
      document.addEventListener("visibilitychange", onVis);
      cleanup.push(() => document.removeEventListener("visibilitychange", onVis));

      const foot = h("div", { class: "paper-foot" }, bBtn, iBtn, h("span", { class: "fmt-sep" }), countEl, h("span", null, "·"), status, h("div", { class: "spacer" }),
        h("button", { class: "btn ghost small", onclick: () => { setFocus(!state.focus); body.focus(); } }, icon(ICONS.focus, 16), "Focus"));
      setTimeout(() => { notes && autosize(notes); live(); }, 0);
      return { body, foot, flush };
    }

    function renderScene(nd, info) {
      const isScene = nd.kind === "scene";
      const isChar = nd.kind === "character";
      const crumbs = isScene && parent ? `${parent.title} · Scene` : nd.kind === "overview" ? "Overview & plot" : isChar ? castWord(project.type, true) : "Scene";
      const title = nd.kind === "overview" ? null : noAI(h("input", { class: "title-input", value: nd.title, maxlength: 200, placeholder: isChar ? "Name" : "Scene title" }));
      let notes = null, notesWrap = null;
      if (isScene || isChar) {
        notes = noAI(h("textarea", { class: "notes", rows: 2, placeholder: isScene ? "What happens here? Planning notes — they don't count toward your 500." : (TYPES[project.type].people ? "In a line: who are they to you?" : "In a line: who are they, and what do they want?") }));
        notes.value = nd.summary;
        const open = !!nd.summary || isChar;
        notesWrap = h("div", { style: { display: open ? "" : "none" } }, notes);
        const toggle = h("button", { class: "notes-toggle", onclick: () => { const vis = notesWrap.style.display === "none"; notesWrap.style.display = vis ? "" : "none"; toggle.textContent = vis ? "Hide notes" : isScene ? "Scene notes" : "One-line summary"; if (vis) { autosize(notes); notes.focus(); } } },
          open ? "Hide notes" : isScene ? "Scene notes" : "One-line summary");
        notesWrap = h("div", null, toggle, notesWrap);
      }
      const placeholder = nd.kind === "overview"
        ? "What's it about? The premise, the plot, the ending you're aiming for…"
        : isChar ? (TYPES[project.type].people ? "Who they are, what they were like then, what you remember…" : "Who they are, how they talk, what they're hiding…")
        : project.type === "script" ? "INT. SOMEWHERE — NIGHT" : "Begin.";
      const ed = makeEditor(nd, info.day, { title, notes, placeholder });
      pane.replaceChildren(
        h("div", { class: "focus-meter" }),
        h("button", { class: "btn small focus-exit", onclick: () => setFocus(false) }, "Leave focus"),
        h("div", { class: "row mobile-only", style: { marginBottom: "10px" } }, h("button", { class: "btn small", onclick: openRail }, icon(ICONS.menu, 16), "Contents")),
        h("div", { class: "paper" },
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("div", { class: "crumbs" }, crumbs),
            h("div", { class: "menu-wrap" }, h("button", { class: "iconbtn", title: "More", "aria-label": "More", onclick: (e) => nodeMenu(e.currentTarget, nd) }, icon(ICONS.more)))),
          nd.kind === "overview" ? h("h1", { style: { fontSize: "30px" } }, "Overview & plot") : title,
          notesWrap,
          ed.body),
        ed.foot);
      updateMeter(state.todayWords);
      if (!nd.body) setTimeout(() => (title && !nd.title ? title : ed.body).focus(), 30);
    }

    function renderSingle(nd, info) {
      const onNotes = nd.kind === "overview";
      const placeholder = onNotes
        ? (project.type === "personal_essay" ? "The idea, the moment it turns on, the people in it, what you want the reader to feel…" : "The argument, sources, quotes, the outline…")
        : project.type === "poem" ? "Begin your poem." : def.notes ? "Begin." : "Just write. Anything at all.";
      const ed = makeEditor(nd, info.day, { placeholder });
      const notesNode = def.notes ? nodes.find((x) => x.kind === "overview") : null;
      const tabs = notesNode ? h("div", { class: "tabs hide-focus", style: { marginBottom: "16px", maxWidth: "740px", marginLeft: "auto", marginRight: "auto" } },
        h("button", { class: onNotes ? "" : "on", onclick: () => onNotes && go(`/p/${pid}`) }, def.label === "Article / essay" ? "Article" : "Essay"),
        h("button", { class: onNotes ? "on" : "", onclick: () => !onNotes && go(`/p/${pid}/${notesNode.id}`) }, "Notes",
          notesNode.words ? h("span", { class: "faint", style: { fontSize: "13px", marginLeft: "6px" } }, fmt(notesNode.words)) : null)) : null;
      pane.replaceChildren(
        h("div", { class: "focus-meter" }),
        h("button", { class: "btn small focus-exit", onclick: () => setFocus(false) }, "Leave focus"),
        h("div", { class: "single-head" },
          h("div", { style: { flex: "1", minWidth: "0" } },
            h("div", { class: "label hide-focus" }, def.label),
            h("h1", { style: { fontSize: "28px", overflowWrap: "anywhere" } }, project.title)),
          h("div", { class: "menu-wrap hide-focus" }, h("button", { class: "iconbtn", title: "Options", "aria-label": "Options", onclick: (e) => popMenu(e.currentTarget, [
            { text: "Rename", onClick: renameProject },
            { text: "Turn it into…", onClick: convert },
            { text: "Export or download", onClick: async () => { if (leaveGuard) await leaveGuard(); go(`/p/${pid}/read`); } },
            { text: "Share…", onClick: () => shareDialog(pid, project.title) },
            { text: "Focus mode", onClick: () => setFocus(true) },
            "-",
            { text: "Delete", danger: true, onClick: deleteProject },
          ]) }, icon(ICONS.more)))),
        tabs,
        h("div", { class: "paper" }, ed.body),
        ed.foot);
      updateMeter(state.todayWords);
      setTimeout(() => ed.body.focus(), 30);
    }

    const onKey = (e) => { if (e.key === "Escape" && state.focus) setFocus(false); };
    document.addEventListener("keydown", onKey);
    cleanup.push(() => document.removeEventListener("keydown", onKey));

    if (def.single) {
      shell(h("div", { class: "room", style: { gridTemplateColumns: "1fr" } }, pane));
    } else {
      drawRail();
      shell(h("div", { class: "room" }, rail, pane));
      const on = rail.querySelector(".rail-item.on");
      if (on) on.scrollIntoView({ block: "nearest" });
    }
  }

  // ---------- manuscript ----------
  // Turn parts into a list of display items honoring the title/break options.
  function manuscriptItems(parts, def, titles, breaks) {
    const items = [];
    let lastC;
    parts.forEach((p, i) => {
      if (def.container && p.containerId !== lastC) {
        items.push({ kind: "container", text: p.container || "" });
        lastC = p.containerId;
      } else if (i > 0 && breaks && !def.single) items.push({ kind: "break" });
      if (titles && !def.single && p.title) items.push({ kind: "title", text: p.title, part: p });
      items.push({ kind: "body", part: p });
    });
    return items;
  }

  function bodyNode(stored, mono) {
    const wrap = h("div", { class: "ms-body" + (mono ? " mono" : "") });
    for (const runs of parseBody(stored.replace(/^\n+|\n+$/g, ""))) {
      const plain = runs.map((r) => r.text).join("");
      if (BREAK_LINE.test(plain)) { wrap.append(h("div", { class: "break" }, "* * *")); continue; }
      const line = h("div", { class: "ms-line" });
      if (plain) line.innerHTML = runsToHtml(runs); else line.append(h("br"));
      wrap.append(line);
    }
    return wrap;
  }

  function manuscriptHtml(project, author, parts, def, titles, breaks) {
    // No inline styles here (the page's security policy blocks them while copying).
    const poemish = project.type === "poem" || project.type === "script";
    let html = `<meta charset="utf-8"><h1 align="center">${escHtml(project.title)}</h1>`;
    if (author) html += `<p align="center"><i>by ${escHtml(author)}</i></p>`;
    for (const it of manuscriptItems(parts, def, titles, breaks)) {
      if (it.kind === "container") html += `<h2 align="center">${escHtml(it.text)}</h2>`;
      else if (it.kind === "break") html += `<p align="center">* * *</p>`;
      else if (it.kind === "title") html += `<h3>${escHtml(it.text)}</h3>`;
      else {
        const lines = parseBody(it.part.body.replace(/^\n+|\n+$/g, ""));
        let stanza = [];
        const endStanza = () => { if (stanza.length) { html += `<p>${stanza.join("<br>")}</p>`; stanza = []; } };
        for (const runs of lines) {
          const plain = runs.map((r) => r.text).join("");
          if (BREAK_LINE.test(plain)) { endStanza(); html += `<p align="center">* * *</p>`; }
          else if (!plain.trim()) endStanza();
          else if (poemish) stanza.push(runsToHtml(runs));
          else html += `<p>${runsToHtml(runs)}</p>`;
        }
        endStanza();
      }
    }
    return html;
  }

  function manuscriptText(project, parts, def, titles, breaks, md) {
    const lines = [md ? `# ${project.title}` : project.title.toUpperCase(), ""];
    for (const it of manuscriptItems(parts, def, titles, breaks)) {
      if (it.kind === "container") lines.push("", md ? `## ${it.text}` : it.text.toUpperCase(), "");
      else if (it.kind === "break") lines.push("", md ? "\\* \\* \\*" : "* * *", "");
      else if (it.kind === "title") lines.push(md ? `### ${it.text}` : it.text, "");
      else lines.push(md ? it.part.body.trim() : toPlain(it.part.body).trim(), "");
    }
    return lines.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n";
  }

  async function copyRich(html, text) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return true;
    } catch {
      // Older browsers: copy from a hidden formatted element.
      const holder = h("div", { contenteditable: "true", style: { position: "fixed", left: "-9999px", top: "0" } });
      holder.innerHTML = html;
      document.body.append(holder);
      const r = document.createRange(); r.selectNodeContents(holder);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch {}
      sel.removeAllRanges(); holder.remove();
      return ok;
    }
  }

  async function renderManuscript(pid) {
    const { project, parts } = await api("GET", `/api/projects/${pid}/manuscript`);
    const def = TYPES[project.type];
    document.title = `${project.title} (manuscript) · 500words`;
    let showTitles = store("w5-ms-titles") !== "0";
    let showBreaks = store("w5-ms-breaks") !== "0";
    const total = parts.reduce((s, p) => s + p.words, 0);
    const body = h("div");
    const mono = project.type === "script";
    function draw() {
      const out = [];
      for (const it of manuscriptItems(parts, def, showTitles, showBreaks)) {
        if (it.kind === "container") out.push(h("h2", { class: "ms-container" }, it.text));
        else if (it.kind === "break") out.push(h("div", { class: "break" }, "* * *"));
        else if (it.kind === "title") out.push(h("h3", { class: "ms-scene" }, link(`/p/${pid}/${it.part.id}`, null, it.text)));
        else out.push(it.part.body.trim() ? bodyNode(it.part.body, mono) : h("p", { class: "unwritten" }, link(`/p/${pid}/${it.part.id}`, null, `${it.part.title || "This scene"} isn't written yet — write it now`)));
      }
      body.replaceChildren(...out);
    }
    draw();
    const filename = (ext) => `${project.title.replace(/[^\p{L}\p{N}\-' ]+/gu, "").trim() || "manuscript"}.${ext}`;
    function download(md) {
      const blob = new Blob([manuscriptText(project, parts, def, showTitles, showBreaks, md)], { type: md ? "text/markdown" : "text/plain" });
      const a = h("a", { href: URL.createObjectURL(blob), download: filename(md ? "md" : "txt") });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    const word = () => { location.href = `/api/projects/${pid}/export.docx?titles=${showTitles ? 1 : 0}&breaks=${showBreaks ? 1 : 0}`; };
    async function google() {
      const ok = await copyRich(manuscriptHtml(project, state.me.displayName, parts, def, showTitles, showBreaks), manuscriptText(project, parts, def, showTitles, showBreaks, false));
      if (!ok) { toast("Your browser wouldn't let us copy. Download the Word file and upload it to Google Drive instead.", true); return; }
      modal((box, close) => box.append(
        h("h2", null, "Copied — now paste it into Google Docs"),
        h("p", { class: "muted" }, "Your whole manuscript, with headings, bold and italics, is on your clipboard. Open a new Google Doc and paste (Ctrl+V, or ⌘V on a Mac)."),
        h("p", { class: "faint", style: { fontSize: "14px" } }, "Prefer a file? Use Word (.docx) — Google Drive opens it as a Google Doc when you upload it."),
        h("div", { class: "actions" },
          h("button", { class: "btn ghost", onclick: () => close() }, "Close"),
          h("a", { class: "btn primary", href: "https://docs.new", target: "_blank", rel: "noopener noreferrer", onclick: () => setTimeout(close, 100) }, "Open a new Google Doc"))));
    }
    const sw = (label, on, set) => h("label", { class: "switch" }, h("input", { type: "checkbox", checked: on, onchange: (e) => set(e.target.checked) }), h("span", { class: "knob" }), h("span", { class: "muted", style: { fontSize: "15px" } }, label));
    const exportMenu = h("div", { class: "menu-wrap" }, h("button", { class: "btn small primary", onclick: (e) => popMenu(e.currentTarget, [
      { text: "Word (.docx)", onClick: word },
      { text: "Copy for Google Docs", onClick: google },
      "-",
      { text: "Plain text (.txt)", onClick: () => download(false) },
      { text: "Markdown (.md)", onClick: () => download(true) },
    ]) }, "Export"));
    shell(h("div", { class: "page" },
      h("div", { class: "manuscript" },
        h("div", { class: "row wrap", style: { justifyContent: "space-between", marginBottom: "10px", rowGap: "10px" } },
          link(`/p/${pid}`, { class: "btn ghost small" }, "← Back to writing"),
          h("div", { class: "row wrap", style: { rowGap: "10px" } },
            def.single ? null : sw("Scene titles", showTitles, (v) => { showTitles = v; store("w5-ms-titles", v ? "1" : "0"); draw(); }),
            def.single ? null : sw("Breaks between scenes", showBreaks, (v) => { showBreaks = v; store("w5-ms-breaks", v ? "1" : "0"); draw(); }),
            h("button", { class: "btn small", onclick: () => shareDialog(pid, project.title) }, "Share"),
            exportMenu)),
        h("div", { style: { textAlign: "center", margin: "40px 0 10px" } },
          h("div", { class: "label" }, def.label),
          h("h1", { style: { fontSize: "40px", marginTop: "6px" } }, project.title),
          h("div", { class: "faint", style: { marginTop: "10px" } }, plural(total, "word"), def.single ? "" : ` · ${plural(parts.length, "scene")}`)),
        body)));
  }

  // ---------- sharing ----------
  async function shareDialog(pid, title) {
    let st;
    try { st = await api("GET", `/api/projects/${pid}/share`); } catch (e) { toast(e.message, true); return; }
    await modal((box, close) => {
      const draw = () => {
        const url = st.token ? `${location.origin}/s/${st.token}` : "";
        const set = async (patch) => {
          try { st = await api("POST", `/api/projects/${pid}/share`, patch); draw(); } catch (e) { toast(e.message, true); }
        };
        const linkBox = h("input", { class: "text", value: url, readonly: true, onfocus: (e) => e.target.select() });
        box.replaceChildren(
          h("h2", null, `Share “${title}”`),
          h("p", { class: "muted", style: { fontSize: "15.5px" } }, "Anyone with the link can read this story — no account needed. They see the finished text only: no notes, no characters, nothing else on your desk. It always shows your latest words."),
          h("label", { class: "switch", style: { margin: "14px 0" } },
            h("input", { type: "checkbox", checked: !!st.token, onchange: (e) => set({ enabled: e.target.checked }) }), h("span", { class: "knob" }),
            h("span", null, st.token ? "Sharing is on" : "Sharing is off")),
          st.token ? h("div", { class: "stack" },
            h("div", { class: "row" }, linkBox,
              h("button", { class: "btn primary", onclick: async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { linkBox.select(); document.execCommand("copy"); toast("Link copied."); } } }, "Copy")),
            h("div", { class: "row wrap" },
              h("label", { class: "switch" }, h("input", { type: "checkbox", checked: st.titles, onchange: (e) => set({ titles: e.target.checked }) }), h("span", { class: "knob" }), h("span", { class: "muted", style: { fontSize: "15px" } }, "Scene titles")),
              h("label", { class: "switch" }, h("input", { type: "checkbox", checked: st.breaks, onchange: (e) => set({ breaks: e.target.checked }) }), h("span", { class: "knob" }), h("span", { class: "muted", style: { fontSize: "15px" } }, "Breaks between scenes"))),
            h("p", { class: "faint", style: { fontSize: "14px" } }, "Shared it with the wrong person? ",
              h("button", { class: "btn ghost small", onclick: () => set({ enabled: true, newLink: true }) }, "Make a new link"),
              " — the old one stops working.")) : null,
          h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => close() }, "Done")));
      };
      draw();
    });
  }

  async function renderShared(token) {
    document.title = "500words";
    let d;
    try {
      d = await api("GET", `/api/shared/${encodeURIComponent(token)}`);
    } catch (e) {
      app.replaceChildren(h("div", { class: "page narrow", style: { textAlign: "center", paddingTop: "80px" } },
        h("div", { class: "wordmark-dark" }, h("b", null, "500"), "words"),
        h("h1", { style: { marginTop: "30px" } }, "This story isn't shared anymore"),
        h("p", { class: "muted" }, "The writer may have turned the link off or made a new one.")));
      return;
    }
    const def = TYPES[d.project.type];
    document.title = `${d.project.title} · ${d.project.author} · 500words`;
    const mono = d.project.type === "script";
    const out = [];
    for (const it of manuscriptItems(d.parts, def, d.titles, d.breaks)) {
      if (it.kind === "container") out.push(h("h2", { class: "ms-container" }, it.text));
      else if (it.kind === "break") out.push(h("div", { class: "break" }, "* * *"));
      else if (it.kind === "title") out.push(h("h3", { class: "ms-scene" }, it.text));
      else if (it.part.body.trim()) out.push(bodyNode(it.part.body, mono));
    }
    app.replaceChildren(
      h("header", { class: "shared-bar" },
        h("a", { class: "wordmark-dark", href: "/" }, h("b", null, "500"), "words"),
        h("button", { class: "iconbtn", title: "Day / evening lamp", "aria-label": "Switch light", onclick: toggleTheme }, icon(ICONS.lamp))),
      h("div", { class: "page" }, h("article", { class: "manuscript" },
        h("div", { style: { textAlign: "center", margin: "30px 0 10px" } },
          h("div", { class: "label" }, def.label),
          h("h1", { style: { fontSize: "40px", marginTop: "6px" } }, d.project.title),
          h("div", { class: "muted", style: { marginTop: "10px", fontStyle: "italic" } }, `by ${d.project.author}`)),
        out,
        h("p", { class: "faint", style: { textAlign: "center", marginTop: "60px", fontSize: "14px" } }, "Written by a person, in 500words. No AI writes here."))));
  }

  // ---------- stats ----------
  function heatmap(history, today, weeks = 26) {
    const by = new Map(history.map((d) => [d.day, d.words]));
    const t = new Date(today + "T12:00:00Z");
    const end = new Date(t); end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));
    const cells = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      const w = by.get(k) || 0;
      const future = k > today;
      const lvl = future ? "future" : w >= GOAL ? "l3" : w >= GOAL / 2 ? "l2" : w > 0 ? "l1" : "";
      const label = new Date(k + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      cells.push(h("i", { class: `${lvl}${k === today ? " today" : ""}`, title: future ? "" : `${label}: ${plural(w, "word")}` }));
    }
    return h("div", null,
      h("div", { class: "heat-wrap" }, h("div", { class: "heat" }, cells)),
      h("div", { class: "heat-legend" }, "None", h("i", { style: { background: "var(--heat-0)" } }), h("i", { style: { background: "var(--heat-1)" } }), h("i", { style: { background: "var(--heat-2)" } }), h("i", { style: { background: "var(--heat-3)" } }), "500+"));
  }
  function weekBars(history, today) {
    const by = new Map(history.map((d) => [d.day, d.words]));
    const days = [];
    const t = new Date(today + "T12:00:00Z");
    for (let i = 6; i >= 0; i--) { const d = new Date(t); d.setUTCDate(d.getUTCDate() - i); days.push(d.toISOString().slice(0, 10)); }
    const max = Math.max(GOAL, ...days.map((d) => by.get(d) || 0));
    return h("div", { class: "week-bars" }, days.map((d) => {
      const w = by.get(d) || 0;
      return h("div", { class: "col" },
        h("span", { class: "v" }, w ? fmt(w) : ""),
        h("div", { class: "b" + (w >= GOAL ? " met" : ""), style: { height: Math.max(2, (w / max) * 110) + "px" } }),
        h("small", null, d === today ? "Today" : new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })));
    }));
  }
  function bignums(s) {
    return h("div", { class: "bignums" },
      h("div", { class: "bignum" }, h("b", null, fmt(s.streak)), h("span", null, "day streak")),
      h("div", { class: "bignum" }, h("b", null, fmt(s.longestStreak)), h("span", null, "longest streak")),
      h("div", { class: "bignum" }, h("b", null, fmt(s.daysMet)), h("span", null, "days at 500+")),
      h("div", { class: "bignum" }, h("b", null, fmt(s.totalWords)), h("span", null, "words written")));
  }
  async function renderStats() {
    document.title = "Stats · 500words";
    const s = await api("GET", "/api/stats");
    updateMeter(s.todayWords);
    const weekTotal = s.history.filter((d) => d.day > new Date(new Date(s.today + "T12:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10)).reduce((a, d) => a + d.words, 0);
    shell(h("div", { class: "page" },
      h("div", { class: "label" }, "Your record"),
      h("h1", null, s.todayWords >= GOAL ? "Today's 500: done." : `${fmt(Math.max(0, GOAL - s.todayWords))} words to go today.`),
      bignums(s),
      h("div", { class: "card" },
        h("div", { class: "row", style: { justifyContent: "space-between" } }, h("h2", null, "The last seven days"), h("span", { class: "faint" }, plural(weekTotal, "word"))),
        weekBars(s.history, s.today)),
      h("div", { class: "card", style: { marginTop: "18px" } },
        h("h2", { style: { marginBottom: "14px" } }, "Six months at the desk"),
        heatmap(s.history, s.today)),
      h("p", { class: "faint", style: { fontSize: "15px", marginTop: "18px" } },
        "Your 500 counts every word you write in a day across all your projects. Pasted text and planning notes don't count. ",
        state.me.isPublic ? "Friends can see these numbers (never your writing). " : "These numbers are private. ",
        link("/settings", null, "Change that"), ".")));
  }

  // ---------- friends ----------
  const initial = (u) => (u.displayName || u.username || "?").trim().charAt(0).toUpperCase();
  const spineFor = (name) => { const c = ["#2f5b4c", "#8a4b2e", "#5b4a7a", "#2e4f6e", "#7a3b44", "#a9864f"]; let x = 0; for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return c[x % c.length]; };

  async function renderFriends() {
    document.title = "Friends · 500words";
    const { friends, followers } = await api("GET", "/api/friends");
    const input = h("input", { class: "text", placeholder: "Their username", autocapitalize: "none", spellcheck: "false", style: { maxWidth: "280px" } });
    const err = h("div", { class: "error" });
    const add = h("form", { class: "row wrap", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try { await api("POST", "/api/friends", { username: input.value }); toast("Added."); render(); } catch (ex) { err.textContent = ex.message; }
    } }, input, h("button", { class: "btn primary" }, "Add a friend"));
    const list = friends.length ? h("div", { class: "stack" }, friends.map((f) => {
      const s = f.stats;
      return h("div", { class: "friend" },
        h("div", { class: "avatar", style: { "--spine": spineFor(f.username) } }, initial(f)),
        h("div", { style: { minWidth: "0" } },
          link(`/w/${f.username}`, { class: "name" }, f.displayName, " ", h("span", { class: "faint", style: { fontSize: "14px" } }, "@" + f.username)),
          s ? h("div", null,
            h("div", { class: "faint", style: { fontSize: "14px" } },
              s.todayWords >= s.goal ? `Done today — ${fmt(s.todayWords)} words` : `${fmt(s.todayWords)} of ${s.goal} today`,
              ` · ${plural(s.streak, "day")} streak`),
            h("div", { class: "mini" }, h("i", { style: { width: Math.min(100, (s.todayWords / s.goal) * 100) + "%" } })))
            : h("div", { class: "faint", style: { fontSize: "14px" } }, "Keeps their stats private.")),
        h("div", { class: "menu-wrap" }, h("button", { class: "iconbtn", title: "Options", onclick: (e) => popMenu(e.currentTarget, [
          { text: "Remove from friends", danger: true, onClick: async () => { await api("DELETE", `/api/friends/${encodeURIComponent(f.username)}`); render(); } },
        ]) }, icon(ICONS.more))));
    })) : h("div", { class: "empty-desk" }, h("h2", null, "Write alongside friends"), h("p", null, "Add writer friends by username to keep each other honest. You'll see their daily count and streak — never their writing."));
    shell(h("div", { class: "page narrow" },
      h("div", { class: "label" }, "Keeping each other honest"),
      h("h1", { style: { marginBottom: "18px" } }, "Friends"),
      h("div", { class: "pledge", style: { marginBottom: "22px" } },
        "Your username is ", h("b", null, "@" + state.me.username), ". ",
        state.me.isPublic ? "Your stats are public, so friends who add you can see your daily count and streak. " : "Your stats are private, so friends who add you won't see your numbers yet. ",
        link("/settings", null, state.me.isPublic ? "Settings" : "Make them public"), followers ? ` · ${plural(followers, "writer")} follow${followers === 1 ? "s" : ""} you.` : ""),
      add, err, h("div", { style: { height: "18px" } }), list));
  }

  async function renderWriter(username) {
    const w = await api("GET", `/api/writers/${encodeURIComponent(username)}`);
    document.title = `${w.displayName} · 500words`;
    const followBtn = w.isMe ? null : h("button", { class: "btn" + (w.following ? "" : " primary"), onclick: async () => {
      try {
        if (w.following) await api("DELETE", `/api/friends/${encodeURIComponent(w.username)}`);
        else await api("POST", "/api/friends", { username: w.username });
        render();
      } catch (e) { toast(e.message, true); }
    } }, w.following ? "Remove from friends" : "Add as a friend");
    shell(h("div", { class: "page" },
      link("/friends", { class: "btn ghost small" }, "← Friends"),
      h("div", { class: "row", style: { margin: "18px 0 6px", justifyContent: "space-between" } },
        h("div", { class: "row" }, h("div", { class: "avatar", style: { "--spine": spineFor(w.username), width: "56px", height: "56px", fontSize: "24px" } }, initial(w)),
          h("div", null, h("h1", null, w.displayName), h("div", { class: "faint" }, "@" + w.username))),
        followBtn),
      w.stats ? [
        h("p", { class: "muted", style: { fontSize: "18px" } }, w.stats.todayWords >= w.stats.goal ? `Wrote ${fmt(w.stats.todayWords)} words today. Done.` : `${fmt(w.stats.todayWords)} of ${w.stats.goal} words today.`),
        bignums(w.stats),
        h("div", { class: "card" }, h("h2", { style: { marginBottom: "14px" } }, "Six months at the desk"), heatmap(w.history, w.today)),
      ] : h("div", { class: "empty-desk", style: { marginTop: "26px" } }, h("h2", null, "Private"), h("p", null, `${w.displayName} keeps their stats private.`))));
  }

  // ---------- settings ----------
  function renderSettings() {
    document.title = "Settings · 500words";
    const me = state.me;
    const name = h("input", { class: "text", value: me.displayName, maxlength: 60 });
    const email = h("input", { class: "text", type: "email", value: me.email || "", autocomplete: "email", placeholder: "you@example.com" });
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch {}
    const tzSel = h("select", { class: "text" }, (zones.length ? zones : [me.timezone]).map((z) => h("option", { value: z, selected: z === me.timezone ? true : null }, z.replace(/_/g, " "))));
    const pub = h("input", { type: "checkbox", checked: me.isPublic });
    const saveProfile = async () => {
      try {
        const r = await api("PUT", "/api/me", { displayName: name.value, isPublic: pub.checked, timezone: tzSel.value, email: email.value });
        state.me = r.user;
        toast("Saved.");
      } catch (e) { toast(e.message, true); }
    };
    pub.addEventListener("change", saveProfile);

    const cur = h("input", { class: "text", type: "password", autocomplete: "current-password" });
    const nxt = h("input", { class: "text", type: "password", autocomplete: "new-password" });
    const pwErr = h("div", { class: "error" });

    shell(h("div", { class: "page narrow" },
      h("div", { class: "label" }, "Settings"),
      h("h1", { style: { marginBottom: "24px" } }, "Your room"),
      h("div", { class: "card stack" },
        h("h2", null, "Profile"),
        h("label", { class: "field" }, h("span", null, "Name"), name),
        h("div", { class: "field" }, h("span", null, "Username"), h("div", null, "@" + me.username)),
        h("label", { class: "field" }, h("span", null, "Email"), email,
          h("div", { class: "hint" }, me.email ? "Used only if you need to reset your password." : "Add one so you can reset your password if you ever forget it.")),
        h("label", { class: "field" }, h("span", null, "Time zone"), tzSel, h("div", { class: "hint" }, "Your day — and your 500 — resets at midnight here.")),
        h("button", { class: "btn primary", onclick: saveProfile }, "Save")),
      h("div", { class: "card stack", style: { marginTop: "18px" } },
        h("h2", null, "Who can see your stats"),
        h("label", { class: "switch" }, pub, h("span", { class: "knob" }), h("span", null, "Public stats")),
        h("p", { class: "muted", style: { margin: "4px 0 0", fontSize: "15.5px" } }, "When this is on, friends who add you can see your daily word count, streaks and calendar. Your projects and your writing are always private — no one sees them but you.")),
      h("div", { class: "card stack", style: { marginTop: "18px" } },
        h("h2", null, "Password"),
        h("label", { class: "field" }, h("span", null, "Current password"), cur),
        h("label", { class: "field" }, h("span", null, "New password"), nxt),
        pwErr,
        h("button", { class: "btn", onclick: async () => {
          pwErr.textContent = "";
          try { await api("PUT", "/api/me/password", { current: cur.value, next: nxt.value }); cur.value = nxt.value = ""; toast("Password changed. Other devices were signed out."); } catch (e) { pwErr.textContent = e.message; }
        } }, "Change password")),
      h("div", { class: "pledge", style: { marginTop: "26px" } },
        h("b", null, "No AI writes here. "), "500words has no AI features of any kind — no suggestions, no autocomplete, no rewriting. It also asks your browser to switch off its own writing suggestions inside the editor. Every word is yours."),
      h("div", { class: "row wrap", style: { marginTop: "26px" } },
        h("button", { class: "btn", onclick: async () => { await api("POST", "/api/logout").catch(() => {}); state.me = null; history.replaceState(null, "", "/"); render(); } }, "Sign out"),
        h("button", { class: "btn danger", onclick: deleteAccount }, "Delete my account"))));
  }
  async function deleteAccount() {
    const pw = await modal((box, close) => {
      const inp = h("input", { class: "text", type: "password", autocomplete: "current-password", autofocus: true });
      box.append(h("form", { onsubmit: (e) => { e.preventDefault(); close(inp.value); } },
        h("h2", null, "Delete your account?"),
        h("p", { class: "muted" }, "This permanently deletes your account, every project and all of your writing. Download anything you want to keep first (each project's manuscript page has a download button)."),
        h("label", { class: "field" }, h("span", null, "Type your password to confirm"), inp),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn ghost", onclick: () => close(null) }, "Keep my account"), h("button", { class: "btn danger solid" }, "Delete everything"))));
    });
    if (!pw) return;
    try { await api("POST", "/api/me/delete", { password: pw }); state.me = null; history.replaceState(null, "", "/"); render(); } catch (e) { toast(e.message, true); }
  }

  // ---------- boot ----------
  (async () => {
    try {
      const r = await api("GET", "/api/me");
      state.me = r.user;
      state.resetEnabled = !!r.resetEnabled;
      if (state.me) {
        // Keep the server's idea of "today" in step with this device.
        const here = tz();
        if (here && here !== state.me.timezone && !store("w5-tz-asked-" + here)) {
          store("w5-tz-asked-" + here, "1");
          api("PUT", "/api/me", { timezone: here }).then((x) => (state.me = x.user)).catch(() => {});
        }
        await refreshToday();
      }
    } catch {}
    render();
  })();
})();
