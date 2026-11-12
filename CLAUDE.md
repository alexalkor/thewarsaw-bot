# Warsaw Events Bot: read me first

## What this is
A Telegram bot (`@thewarsaweventsbot`, public channel `@thewarsawevents`) that
sends a weekly list of Warsaw weekend events in 6 languages: Russian (source
language), English, Polish, Belarusian, Ukrainian, German. Alex (owner) is
not a developer — explain things in plain language, don't assume git/hosting
knowledge, and confirm before any action that touches the live, user-facing
bot.

## The pipeline, end to end
1. **Source text** (Russian) for the week's events comes from `@thewarsawevents`
   — either a channel post (auto-ingested) or pasted directly by the admin.
2. **Ingestion** happens at a `POST /events` endpoint (plus `POST /translate`
   per language), protected by an `X-Secret` header. Two Friday scheduled
   tasks do this: "The-Warsaw Events Collect (PC Chrome)" (11:00 Warsaw, reads
   the-warsaw.pl in Alex's Chrome, hands the list off) and "The-Warsaw Weekly
   Publish (cloud)" (runs on that hand-off, fallback 13:47 Warsaw; publishes the
   the-warsaw list, then builds and publishes the top picks). The repo side is the `warsaw-events-update` skill
   (`.claude/skills/warsaw-events-update/SKILL.md`), `tools/weekly.mjs` and one
   file per weekend in `data/weekly/` (see its README): "collect" writes the
   Russian facts, "publish" (fully cloud) translates, posts and verifies.
   the-warsaw.pl sits behind a Cloudflare bot check, so collect can't run from
   a cloud machine. It needs a browser the site lets through (Alex's Chrome) or
   the site's permission. Cloud runs use the personal cloud environment
   `thewarsaw-bot`, whose network proxy injects the Worker's `X-Secret`. Never
   put the secret in a task prompt.
3. **Storage**: the event text + its per-language translations live in
   Cloudflare Workers KV, backed up to this repo at `data/events.json` via
   the GitHub API, so nothing is lost if the Worker's KV ever needs clearing.
4. **Translation**: MyMemory API (free), called on demand per language,
   cached afterwards so it's only paid for once per language per event.
5. **Delivery**: after choosing a language the user sees two lists: "📋 The-Warsaw
   weekend list" (feed `warsaw`) and "⭐ Top picks this weekend" (feed `picks`,
   built by Claude from open event sources, fully in the cloud). Each feed has
   its own KV key and GitHub backup file (`data/events.json`, `data/picks.json`).
   `worker.js` v3.1 (two lists) is live since 12 Nov 2026 (`/health` shows the
   version). `tools/weekly.mjs` refuses to post `picks` to a Worker without
   feed support, so an older Worker can't have its the-warsaw list overwritten.
   User presses a list button in Telegram → bot reads
   the cached event, translates if needed, sends it in chunks (Telegram has
   a ~4096-char message limit), re-attaches the menu keyboard.

## Current production system: the Cloudflare Worker
`cloudflare-worker/worker.js` is the live bot — confirmed via Telegram's
`getWebhookInfo` (Nov 2026): the webhook points at
the Worker's own `…workers.dev/webhook` address (shown in the Cloudflare
dashboard; deliberately not written in this public repo). See
`cloudflare-worker/README.md` for what it is, how it's deployed, and the
read-only way to re-check this if it's ever in doubt.

A second, older implementation (everything under `legacy/`: `main.py`,
`handlers/`, `database/`, `keyboards/`, `utils/`, `locales/`) talks to Telegram via
long-polling instead of a webhook. Telegram only delivers to one of the two
at a time, so **this Python implementation is retired / not currently
serving users** — it's kept in the repo for reference only until a decision
is made on whether to delete it outright (see "To confirm later").

## Where things live
- `cloudflare-worker/` — the live implementation (`worker.js`) + its own README.
- `wrangler.toml`, `package.json` (repo root) — Worker deploy config and the
  pinned `wrangler` version (`npm run dev` / `deploy` / `tail`). The KV
  namespace id in `wrangler.toml` is the real `warsaw_events_kv` one, so
  `npm run deploy` overwrites the LIVE Worker — needs an explicit go-ahead
  (rule 3 below). `wrangler.toml` matches the live settings (compatibility
  date 2026-08-15, workers.dev on, preview URLs off), so a deploy changes only
  the code. Cloud sessions in the `thewarsaw-bot` environment can deploy: the
  network proxy injects a Workers-only Cloudflare API token (expires 12 Dec
  2026). Run with `CLOUDFLARE_API_TOKEN=proxy-injected`. Workers Builds is not connected to this repo (checked in
  the Cloudflare dashboard, Nov 2026): nothing auto-deploys from GitHub.
- `legacy/` — the retired long-polling implementation (`main.py`, `handlers/`,
  `database/`, `keyboards/`, `utils/`, `locales/`, `requirements.txt`). Kept in
  its own folder so a root-level `requirements.txt` can't trigger a Python
  `pip install` in Cloudflare Workers Builds. Run it from inside `legacy/`.
- `.claude/skills/warsaw-events-update/`, `tools/weekly.mjs`, `data/weekly/` —
  the weekly collect → publish flow (step 2 above).
- `LICENSE` — MIT.
- `data/events.json` — GitHub-backed cache the live Worker reads and writes.
  `data/events.txt` is an older legacy fallback, no longer used.

## Rules for every session
1. This repo is **public** on GitHub. Never commit a real token, API key, or
   webhook secret — not in code, not in `wrangler.toml`, not in a config
   file. Secrets are Cloudflare "secret" bindings (`wrangler secret put`, or
   the dashboard's Settings → Variables with "Encrypt" on) — never plain
   `[vars]` or a literal in `worker.js`.
2. Don't assume which system is live without checking — see
   `cloudflare-worker/README.md`'s `getWebhookInfo` instructions.
3. A change that could affect real users right now (setWebhook, deploying
   over the live Worker, clearing KV/GitHub cache, changing the bot token)
   needs an explicit go-ahead first, even if a prior message approved
   something similar.
4. Keep this file and `cloudflare-worker/README.md` in sync with reality —
   don't let documentation describe a system that's no longer true, the way
   the original undocumented Worker drifted from the Python bot.

## Known issues
- The Worker's GitHub backup (`data/events.json`) stopped updating after 25 Jul
  2026. The v3.0 code that was live still pointed at the repo's old name
  (`telegram-multilang-bot`), sent no User-Agent (GitHub's API rejects that), and
  hid the error. v3.1 (live since 12 Nov 2026) fixes both and logs failures
  (`npm run tail`, which only works from a local machine; the cloud network
  blocks its connection). Still not writing after the v3.1 deploy (checked
  12 Nov 2026: no `data/picks.json` after a post), so the `GITHUB_PAT` Worker
  secret has probably expired or lost access. Fix: a new fine-grained token with
  Contents read/write on this repo only, saved as the Worker's `GITHUB_PAT`
  secret. Low impact: KV holds the live data and `data/weekly/` is the record.
- `tools/weekly.mjs` re-runs itself with `NODE_USE_ENV_PROXY=1`: Node's fetch
  ignores HTTPS_PROXY otherwise, and only the proxy adds the Worker's X-Secret
  (without it every post gets 401).

## To confirm later
- Whether to delete the retired long-polling implementation outright, or
  keep it around as reference/fallback.
- How "collect" reads the-warsaw.pl: Alex's Chrome (PC on Friday mornings),
  permission from the-warsaw.pl to read it from the cloud, or a different
  open source. The cloud can't pass its bot check (Nov 2026).
- Whether this bot becomes an alkor.dev module (see `alexalkor/alkordev`
  repo's `modules/registry.md` — it's currently listed inconsistently there,
  once as "The-Warsaw Weekend Events Bot" (live) and once as "Telegram
  Multilang Bot" (backlog) — same project, needs cleanup).
