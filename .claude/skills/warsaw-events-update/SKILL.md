---
name: warsaw-events-update
description: Weekly Warsaw weekend-events update for the Telegram bot. "collect" writes this weekend's events into data/weekly/<saturday>.json; "publish" (runs fully in the cloud) adds 5 translations, posts everything to the live Worker and verifies it. Use for the Friday scheduled tasks or when asked to (re)publish the weekend list.
---

# Warsaw weekend events — weekly update

Two phases, joined by one file in git: `data/weekly/<saturday YYYY-MM-DD>.json`.
Format: `data/weekly/README.md`. Script: `tools/weekly.mjs` (Node, no deps).

Ask nothing: these run unattended. Work on `main` (`git pull --ff-only origin main`
first), commit only `data/weekly/`, push to `main`.

## Phase 1: collect (needs a browser that can open the-warsaw.pl)

the-warsaw.pl is behind a Cloudflare bot check. Do NOT try to get past it from
the cloud (no fake user agents, stealth browsers or proxy services). Use only
a source that serves the page normally (Alex's own Chrome via Claude in Chrome,
or an access route the-warsaw.pl has agreed to). If the page shows a
"Just a moment…" check, stop and report it.

1. Open https://www.the-warsaw.pl/category/wheretogo/ and find the newest article
   titled like "Чем заняться (на этих)? выходных в Варшаве (<dates>)" whose dates
   are the current or upcoming weekend. None → write nothing, report
   "no article yet (checked <time>)", stop.
2. If `data/weekly/<saturday>.json` already exists with the same `source.url`, stop:
   already collected.
3. Read the article's events in order, stopping at the first of: "Посетить Kosmopark",
   "Плести маскировочные сети для ВСУ", "Выставка LEGO на PGE Narodowym",
   "Выставка сказочных мини-инсталляций из сладостей". Keep one running count across
   the whole article; check for duplicates at the end.
4. For each event write the `ru` block as FACTS in your own words: a short title,
   a 1–2 sentence original description (paraphrase, never copy the article's text:
   this repo is public), when, where, price. Set `paid` (true if tickets are sold)
   and pick a content emoji (never 🏠): 🎤 concert/standup · 🎬 cinema · 🏊 pool ·
   🎡 festival/fair · 🍕 food · 🛍 market · 🌿 park/nature · 🎭 theatre · 🖼 exhibition ·
   ✨ light/immersive show · 🧠 science · 🎨 workshop · ⛵ sport · 🎠 family/kids ·
   🕺 party/dance · 🎆 holiday · 🚲 outdoor · 🍳 brunch · 🏃 run · ⚽ football ·
   🐾 pets · 📚 books — your judgment otherwise.
5. `date_range.ru` = the dates in the title's parentheses (e.g. "13–15 ноября").
6. `node tools/weekly.mjs validate <file> --ru-only` until OK, commit
   "Collect weekend events <date_range.ru>", push to main.
7. If the Claude_Code_Remote tools are available, start the publish task now
   (fire_trigger for the scheduled task named "The-Warsaw Events Publish (cloud)").
   It also runs on its own schedule as a fallback.

## Phase 2: publish (fully cloud)

1. `F=$(node tools/weekly.mjs latest)`; `node tools/weekly.mjs status $F`.
   - No file, or the file's `weekend` Saturday is already past → report
     "nothing collected for this weekend" and stop (the bot keeps last week's list).
   - `published.verified` is true AND `already_live` is true → report "already
     published" and stop.
2. `node tools/weekly.mjs validate $F --ru-only` must pass.
3. Translate every event into `en`, `pl`, `be`, `uk`, `de` (title, desc, when, where,
   price) and `date_range` for each language, writing them into the same file.
   Keep the event order, emoji and `paid` unchanged. Date headers: "November 13–15",
   "13–15 listopada", "13–15 лістапада", "13–15 листопада", "13.–15. November"
   (German: no space after the first period). No field may start with
   "<digit>. " (e.g. Polish "67. sezon", German "15. Ausgabe") — reword
   ("Trwa 67. sezon", "zum 15. Mal").
4. `node tools/weekly.mjs validate $F` until OK. Then
   `node tools/weekly.mjs publish $F --dry-run`, then `node tools/weekly.mjs publish $F`.
   The Worker's X-Secret is injected by the environment's network proxy — never
   look for, print or write the real value. HTTP 401 → stop and report that the
   saved network secret for the Worker host needs re-saving.
5. publish posts Russian to /events, each language to /translate, checks /debug
   counts against the Russian count, retries a failed language once, and writes
   `published` into the file. Exit code 2 = some language still wrong.
6. Commit the file ("Publish weekend events <date_range.ru>") and push to main.

Final reply: date range, event count, /events result, each language's
/translate result and /debug count, and either "all 5 translations verified" or
the languages still missing. Never report a partial run as success.
