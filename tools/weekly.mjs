#!/usr/bin/env node
// Weekly events helper: validates a data/weekly/<saturday>.json file, renders
// the bot text for each language, and publishes it to the live Worker.
//
// Two lists ("feeds"): data/weekly/<saturday>.json is the-warsaw.pl list
// (feed "warsaw"), data/weekly/<saturday>.picks.json is the open-sources top
// picks (feed "picks"). The file's "feed" field decides where it is posted.
//
//   node tools/weekly.mjs latest [--picks]       path of the newest weekly file
//   node tools/weekly.mjs validate <file> [--ru-only]
//   node tools/weekly.mjs render <file> <lang>   print the text the bot will get
//   node tools/weekly.mjs status [<file>]        what the live bot holds now
//   node tools/weekly.mjs publish <file> [--dry-run]
//
// No dependencies. The Worker's X-Secret is injected by the cloud
// environment's network proxy; this script only sends a placeholder.
// Never put the real secret in this file, in a weekly file, or in a task prompt.

import fs from 'node:fs';
import path from 'node:path';

// The Worker's address is kept out of this public repo: set WORKER_URL (the
// thewarsaw-bot cloud environment has it as a variable).
const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
if (!WORKER && !['validate', 'render', 'latest', undefined].includes(process.argv[2])) {
  console.error('ERROR: WORKER_URL is not set (the bot Worker\'s https://…workers.dev address).');
  process.exit(1);
}
const SECRET = process.env.WORKER_SECRET || 'proxy-injected';
const LANGS = ['ru', 'en', 'pl', 'be', 'uk', 'de'];
const TRANSLATED = LANGS.slice(1);
const ITEM_RE = /^\d+\.\s/;
const FEEDS = ['warsaw', 'picks'];
const feedOf = (data) => data.feed || 'warsaw';

const LABELS = {
  ru: { when: 'Когда', where: 'Где', free: 'Вход', paid: 'Билеты' },
  en: { when: 'When', where: 'Where', free: 'Entry', paid: 'Tickets' },
  pl: { when: 'Kiedy', where: 'Gdzie', free: 'Wstęp', paid: 'Bilety' },
  be: { when: 'Калі', where: 'Дзе', free: 'Уваход', paid: 'Квіткі' },
  uk: { when: 'Коли', where: 'Де', free: 'Вхід', paid: 'Квитки' },
  de: { when: 'Wann', where: 'Wo', free: 'Eintritt', paid: 'Tickets' },
};

const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };
const load = (file) => {
  if (!file || !fs.existsSync(file)) die(`file not found: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`${file} is not valid JSON: ${e.message}`); }
};
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();

// Body only (numbered list, no header). /events gets this plus date_range.
function renderBody(data, lang) {
  const L = LABELS[lang];
  return data.events.map((ev, i) => {
    const t = ev[lang];
    const priceLine = ev.paid ? `🎫 ${L.paid}: ${oneLine(t.price)}` : `💰 ${L.free}: ${oneLine(t.price)}`;
    return [
      `${i + 1}. ${ev.emoji} ${oneLine(t.title)}`,
      oneLine(t.desc),
      `🕐 ${L.when}: ${oneLine(t.when)}`,
      `📍 ${L.where}: ${oneLine(t.where)}`,
      priceLine,
      ...(ev.link ? [`🔗 ${oneLine(ev.link)}`] : []),
    ].join('\n');
  }).join('\n\n');
}

// /translate stores text verbatim, so translations carry their own header.
function renderFull(data, lang) {
  return `${oneLine(data.date_range[lang])}\n\n${renderBody(data, lang)}`;
}

const countItems = (text) => text.split('\n').filter((l) => ITEM_RE.test(l)).length;

function validate(data, { ruOnly = false } = {}) {
  const errs = [];
  const langs = ruOnly ? ['ru'] : LANGS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.weekend || '')) errs.push('weekend must be the Saturday as YYYY-MM-DD');
  else if (new Date(`${data.weekend}T12:00:00Z`).getUTCDay() !== 6) errs.push(`weekend ${data.weekend} is not a Saturday`);
  if (!FEEDS.includes(feedOf(data))) errs.push(`feed must be one of ${FEEDS.join(', ')}`);
  if (feedOf(data) === 'picks') {
    if (!Array.isArray(data.sources) || !data.sources.length) errs.push('sources (list of URLs used) missing');
  } else if (!data.source?.url) errs.push('source.url missing');
  if (!Array.isArray(data.events) || data.events.length === 0) errs.push('events must be a non-empty array');
  for (const lang of langs) {
    const dr = data.date_range?.[lang];
    if (!dr || !oneLine(dr)) errs.push(`date_range.${lang} missing`);
    else if (ITEM_RE.test(oneLine(dr))) errs.push(`date_range.${lang} "${dr}" starts like a list item (digit, period, space) - write e.g. "13.–15. November"`);
  }
  (data.events || []).forEach((ev, i) => {
    const n = i + 1;
    if (!ev.emoji || /\p{L}|\d/u.test(ev.emoji)) errs.push(`event ${n}: emoji missing or not an emoji`);
    if (ev.emoji === '🏠') errs.push(`event ${n}: pick a real emoji, not 🏠`);
    if (typeof ev.paid !== 'boolean') errs.push(`event ${n}: paid must be true or false`);
    if (ev.link != null && !/^https:\/\/\S+$/.test(ev.link)) errs.push(`event ${n}: link must be one https:// URL`);
    if (feedOf(data) === 'picks' && !ev.link) errs.push(`event ${n}: picks need a link to the event page`);
    for (const lang of langs) {
      const t = ev[lang];
      if (!t) { errs.push(`event ${n}: ${lang} block missing`); continue; }
      for (const f of ['title', 'desc', 'when', 'where', 'price']) {
        if (!oneLine(t[f])) errs.push(`event ${n}: ${lang}.${f} empty`);
      }
      for (const f of ['desc', 'when', 'where', 'price']) {
        if (ITEM_RE.test(oneLine(t[f]))) errs.push(`event ${n}: ${lang}.${f} starts with "<digit>. " and would be read as a new item - reword it ("${oneLine(t[f]).slice(0, 40)}")`);
      }
    }
  });
  if (!errs.length) {
    for (const lang of langs) {
      const c = countItems(renderBody(data, lang));
      if (c !== data.events.length) errs.push(`${lang}: rendered ${c} items, expected ${data.events.length}`);
    }
  }
  return errs;
}

async function http(method, route, body) {
  const res = await fetch(`${WORKER}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', 'X-Secret': SECRET } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json; try { json = await res.json(); } catch { json = { ok: false, error: `non-JSON response (HTTP ${res.status})` }; }
  return { status: res.status, json };
}

async function liveHeader(feed) {
  const { json } = await http('GET', `/events?feed=${feed}`);
  return json?.event?.raw ? json.event.raw.split('\n')[0].trim() : null;
}

const feedDebug = (debug, feed) => debug.feeds ? debug.feeds[feed] : (feed === 'warsaw' ? debug : null);

async function cmdStatus(file) {
  const data = file ? load(file) : null;
  const feed = data ? feedOf(data) : 'warsaw';
  const debug = (await http('GET', '/debug')).json;
  const fd = feedDebug(debug, feed);
  const header = (debug.feeds || feed === 'warsaw') ? await liveHeader(feed) : null;
  const out = { worker_version: debug.version, worker_has_picks: !!debug.feeds, feed, live_header: header, event_id: fd?.event_id, translations: fd?.translations };
  if (data) {
    out.file_date_range = data.date_range?.ru;
    out.already_live = header === oneLine(data.date_range?.ru);
    out.published = data.published || null;
  }
  console.log(JSON.stringify(out, null, 2));
}

async function verify(feed, expected) {
  const tr = feedDebug((await http('GET', '/debug')).json, feed)?.translations || {};
  const bad = TRANSLATED.filter((l) => parseInt(tr[l], 10) !== expected);
  return { translations: tr, bad };
}

async function cmdPublish(file, dryRun) {
  const data = load(file);
  const errs = validate(data);
  if (errs.length) die(`validation failed:\n- ${errs.join('\n- ')}`);
  const feed = feedOf(data);
  if (feed !== 'warsaw') {
    // A Worker without feed support ignores "feed" and would overwrite the
    // the-warsaw.pl list. Refuse until the new Worker is deployed.
    const debug = (await http('GET', '/debug')).json;
    if (!debug.feeds) die(`the live Worker (${debug.version}) has no "${feed}" list yet; deploy the new worker.js first. Nothing was posted.`);
  }
  const ruBody = renderBody(data, 'ru');
  const ruCount = countItems(ruBody);
  const texts = Object.fromEntries(TRANSLATED.map((l) => [l, renderFull(data, l)]));
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, ruCount, date_range: data.date_range.ru, chars: Object.fromEntries(TRANSLATED.map((l) => [l, texts[l].length])) }, null, 2));
    return;
  }
  const report = { file, feed, ruCount, at: new Date().toISOString() };

  const ev = await http('POST', '/events', { feed, text: ruBody, date_range: oneLine(data.date_range.ru), mode: 'replace' });
  report.events = ev.json;
  if (!ev.json?.ok) { console.log(JSON.stringify(report, null, 2)); die(`/events failed (HTTP ${ev.status}); translations not sent`); }

  report.translate = {};
  for (const lang of TRANSLATED) {
    try { report.translate[lang] = (await http('POST', '/translate', { feed, lang, text: texts[lang] })).json; }
    catch (e) { report.translate[lang] = { ok: false, error: String(e) }; }
  }

  let v = await verify(feed, ruCount);
  report.retried = [];
  for (const lang of v.bad) {
    report.retried.push(lang);
    try { report.translate[lang] = (await http('POST', '/translate', { feed, lang, text: texts[lang] })).json; }
    catch (e) { report.translate[lang] = { ok: false, error: String(e) }; }
  }
  if (v.bad.length) v = await verify(feed, ruCount);
  report.debug_translations = v.translations;
  report.still_bad = v.bad;
  report.verified = v.bad.length === 0;

  data.published = { at: report.at, event_id: ev.json.event_id, ru_count: ruCount, verified: report.verified, still_bad: v.bad };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.verified) process.exit(2);
}

function cmdLatest(picks) {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'weekly');
  const re = picks ? /^\d{4}-\d{2}-\d{2}\.picks\.json$/ : /^\d{4}-\d{2}-\d{2}\.json$/;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : [];
  if (!files.length) die('no weekly files in data/weekly/');
  console.log(path.join('data', 'weekly', files.at(-1)));
}

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));

switch (cmd) {
  case 'latest': cmdLatest(flags.has('--picks')); break;
  case 'validate': {
    const data = load(pos[0]);
    const errs = validate(data, { ruOnly: flags.has('--ru-only') });
    if (errs.length) die(`validation failed:\n- ${errs.join('\n- ')}`);
    console.log(`OK: ${data.events.length} events, ${flags.has('--ru-only') ? 'ru only' : 'all 6 languages'}`);
    break;
  }
  case 'render': {
    const data = load(pos[0]); const lang = pos[1] || 'ru';
    if (!LANGS.includes(lang)) die(`lang must be one of ${LANGS.join(', ')}`);
    console.log(lang === 'ru' ? `${oneLine(data.date_range.ru)}\n\n${renderBody(data, 'ru')}` : renderFull(data, lang));
    break;
  }
  case 'status': await cmdStatus(pos[0]); break;
  case 'publish': await cmdPublish(pos[0], flags.has('--dry-run')); break;
  default:
    console.log('usage: node tools/weekly.mjs latest [--picks] | validate <file> [--ru-only] | render <file> <lang> | status [<file>] | publish <file> [--dry-run]');
    process.exit(cmd ? 1 : 0);
}
