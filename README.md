# 500words

A quiet writing room for a daily 500 words — live at https://500words.org.

**The rule: no AI writing, anywhere in the app.** No text generation, suggestions,
autocomplete or rewriting — on the server or in the browser. The editor also asks the
browser to switch off its own writing suggestions. Every word is the writer's own.

## What it does
- Projects: novel, short story, movie script, play, poem, freeform.
- Novels: overview, characters, chapters → scenes. Plays/scripts: acts → scenes.
  Short stories: scenes. Poems/freeform: one page. Any project can be converted to another type.
- Scenes are planned (title + notes) in a chapter outline and written in any order;
  the manuscript view reads them back in order and downloads as .txt or .md.
- Daily goal: 500 words across all projects. Per node per day the app records the word
  count when the day's first edit began (baseline); today's words = net new words per node,
  floored at zero. Pasted text is stored but doesn't count. Planning notes don't count.
- Streaks, calendar, last-7-days chart. Public/private stats; friends by username see
  numbers only, never writing.

- Import: Word (.docx), Google Docs links (doc shared "anyone with the link"; fetched only from
  Google's export URL), .txt and .md. Headings → chapters/acts and scenes; `* * *` breaks split scenes.
  Imported words never count toward the daily 500.
- Password reset by email (optional email on accounts), sent through Resend.

- Writing supports **bold** and _italic_ (stored as `**…**` / `_…_`, with `\ * _` escaped).
  Paste and drop come in as plain text.
- Manuscript view: toggles for scene titles and breaks between scenes; export to Word (.docx),
  "Copy for Google Docs" (formatted clipboard + docs.new), .txt and .md.
- Share one story by a private read-only link (`/s/<token>`): on/off, new link, titles/breaks options.

## Stack
Bun + Postgres (Bun's built-in SQL client), vanilla JS front end, no third-party scripts.
Deployed on Railway from this repo (Dockerfile). Variables: `DATABASE_URL`, `APP_URL`
(https://500words.org, used in reset links), `RESEND_API_KEY` and `MAIL_FROM` for reset email.
Locally, `MAIL_DEV=log` prints emails to the console instead of sending them.

## Develop
    DATABASE_URL=postgres://... bun src/server.ts
    DATABASE_URL=postgres://.../test_db bun test   # wipes that test database
