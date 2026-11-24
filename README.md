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

## Stack
Bun + Postgres (Bun's built-in SQL client), vanilla JS front end, no third-party scripts.
Deployed on Railway from this repo (Dockerfile). Needs `DATABASE_URL`.

## Develop
    DATABASE_URL=postgres://... bun src/server.ts
    DATABASE_URL=postgres://.../test_db bun test   # wipes that test database
