# Weekly event files

Two files per weekend, one per bot list: `<saturday YYYY-MM-DD>.json`
(the-warsaw.pl list, `"feed": "warsaw"` or no feed field) and
`<saturday>.picks.json` (top picks from open sources, `"feed": "picks"`,
a `sources` list instead of `source`, and a `link` on every event). The collect step writes the
Russian facts; the publish step adds the 5 translations, posts them to the live
Worker and records the result in `published`. Steps:
`.claude/skills/warsaw-events-update/SKILL.md`. Tool: `tools/weekly.mjs`.

```json
{
  "weekend": "2026-11-14",
  "date_range": { "ru": "13–15 ноября", "en": "November 13–15", "pl": "13–15 listopada",
                  "be": "13–15 лістапада", "uk": "13–15 листопада", "de": "13.–15. November" },
  "source": { "url": "https://www.the-warsaw.pl/...", "title": "...", "collected_at": "2026-11-13T10:05:00Z" },
  "events": [
    { "emoji": "🎤", "paid": true, "link": "https://… (optional; required for picks)",
      "ru": { "title": "...", "desc": "...", "when": "...", "where": "...", "price": "..." },
      "en": { "...": "same five fields" } }
  ],
  "published": { "at": "...", "event_id": 24, "ru_count": 38, "verified": true, "still_bad": [] }
}
```

Descriptions are short paraphrases, never the source article's text: this repo
is public. The script builds the bot text from these fields (numbering, emoji,
🕐/📍/💰 or 🎫 labels per language), so the layout is always the same.
