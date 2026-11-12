// Warsaw Events Bot — Cloudflare Worker
// 6 languages · KV storage · GitHub translation backup · Telegram webhook
//
// This is the git-tracked version of the Worker that used to live only in
// the Cloudflare dashboard's inline editor. Feature parity with the Python
// (long-polling) implementation in this repo: admin broadcast, channel
// auto-ingest, /myid, and on-demand MyMemory translation.
//
// This Worker is the live, production bot (confirmed via Telegram's
// getWebhookInfo). The Python implementation in legacy/ is retired.
//
// Secrets (BOT_TOKEN, GITHUB_PAT, WEBHOOK_SECRET, ADMIN_USER_ID) are never
// hardcoded here — they come from env, set via `wrangler secret put` or the
// dashboard's Settings → Variables (encrypted). See README.md in this folder.

const GITHUB_REPO        = 'alexalkor/thewarsaw-bot';
// Two lists ("feeds") the user can pick from the menu. `warsaw` is the
// original one (the-warsaw.pl article, channel posts, admin posts); `picks`
// is the list Claude builds from open event sources. Each has its own KV key
// and GitHub backup file. API calls without a `feed` field mean `warsaw`.
const FEEDS = {
  warsaw: { kv: 'current_event', file: 'data/events.json' },
  picks:  { kv: 'current_picks', file: 'data/picks.json' },
};
const DEFAULT_FEED = 'warsaw';
const DEFAULT_CHANNEL    = 'thewarsawevents';
const ITEMS_PER_MSG      = 10;
const TG_MAX_CHARS       = 3900;
const SOURCE_LANG        = 'ru';
const MYMEMORY_EMAIL     = 'bot@thewarsawevents.com';
const VERSION            = 'v3.1-cloudflare';

const I18N = {
  en: { welcome:'👋 Hi! Welcome to Warsaw Events Bot! Please choose your language:', lang_set:n=>`✅ Language set to ${n}.`, choose_action:'Weekend event-list from The-Warsaw', btn_events:'📋 The-Warsaw weekend list', btn_picks:'⭐ Top picks this weekend', btn_lang:'🌐 Change language', btn_stop:'⛔ Stop', stopped:'Bot stopped. Send /start to resume.', no_events:'No events published yet.', no_picks:'This weekend\'s top picks are not ready yet.', header:'📅 <b>Latest events in Warsaw:</b>', picks_header:'⭐ <b>Top picks in Warsaw this weekend:</b>', footer:"Hope you're having a great weekend! 🌟", help:'📖 <b>Help</b>\n\nCommands:\n/start — main menu\n/language — change language\n/help — this message' },
  ru: { welcome:'👋 Привет! Добро пожаловать в Warsaw Events Bot! Выберите язык:', lang_set:n=>`✅ Язык установлен: ${n}.`, choose_action:'Список событий выходных от The-Warsaw', btn_events:'📋 Подборка выходных от The-Warsaw', btn_picks:'⭐ Лучшее на этих выходных', btn_lang:'🌐 Сменить язык', btn_stop:'⛔ Остановить', stopped:'Бот остановлен. Отправьте /start для возобновления.', no_events:'События ещё не опубликованы.', no_picks:'Подборка лучшего на эти выходные ещё готовится.', header:'📅 <b>Актуальные события в Варшаве:</b>', picks_header:'⭐ <b>Лучшее в Варшаве на этих выходных:</b>', footer:'Отличных выходных! 🌟', help:'📖 <b>Помощь</b>\n\nКоманды:\n/start — главное меню\n/language — сменить язык\n/help — это сообщение' },
  pl: { welcome:'👋 Witaj w Warsaw Events Bot! Wybierz język:', lang_set:n=>`✅ Język ustawiony na ${n}.`, choose_action:'Lista wydarzeń weekendowych od The-Warsaw', btn_events:'📋 Lista weekendowa The-Warsaw', btn_picks:'⭐ Najlepsze w ten weekend', btn_lang:'🌐 Zmień język', btn_stop:'⛔ Stop', stopped:'Bot zatrzymany. Wyślij /start, aby wznowić.', no_events:'Brak opublikowanych wydarzeń.', no_picks:'Najlepsze propozycje na ten weekend jeszcze się przygotowują.', header:'📅 <b>Najnowsze wydarzenia w Warszawie:</b>', picks_header:'⭐ <b>Najlepsze w Warszawie w ten weekend:</b>', footer:'Miłego weekendu! 🌟', help:'📖 <b>Pomoc</b>\n\nPolecenia:\n/start — menu główne\n/language — zmień język\n/help — ta wiadomość' },
  be: { welcome:'👋 Прывітанне! Сардэчна запрашаем у Warsaw Events Bot! Выберыце мову:', lang_set:n=>`✅ Мова ўстаноўлена: ${n}.`, choose_action:'Спіс падзей выхадных ад The-Warsaw', btn_events:'📋 Падборка выхадных ад The-Warsaw', btn_picks:'⭐ Лепшае на гэтых выхадных', btn_lang:'🌐 Змяніць мову', btn_stop:'⛔ Спыніць', stopped:'Бот спынены. Адпраўце /start для аднаўлення.', no_events:'Падзеі яшчэ не апублікаваны.', no_picks:'Падборка лепшага на гэтыя выхадныя яшчэ рыхтуецца.', header:'📅 <b>Апошнія падзеі ў Варшаве:</b>', picks_header:'⭐ <b>Лепшае ў Варшаве на гэтых выхадных:</b>', footer:'Цудоўных выхадных! 🌟', help:'📖 <b>Дапамога</b>\n\nКаманды:\n/start — галоўнае меню\n/language — змяніць мову\n/help — гэтае паведамленне' },
  uk: { welcome:'👋 Привіт! Ласкаво просимо до Warsaw Events Bot! Оберіть мову:', lang_set:n=>`✅ Мову встановлено: ${n}.`, choose_action:'Список подій вихідних від The-Warsaw', btn_events:'📋 Добірка вихідних від The-Warsaw', btn_picks:'⭐ Найкраще на цих вихідних', btn_lang:'🌐 Змінити мову', btn_stop:'⛔ Зупинити', stopped:'Бот зупинено. Надішліть /start для відновлення.', no_events:'Події ще не опубліковані.', no_picks:'Добірка найкращого на ці вихідні ще готується.', header:'📅 <b>Актуальні події у Варшаві:</b>', picks_header:'⭐ <b>Найкраще у Варшаві на цих вихідних:</b>', footer:'Чудових вихідних! 🌟', help:'📖 <b>Допомога</b>\n\nКоманди:\n/start — головне меню\n/language — змінити мову\n/help — це повідомлення' },
  de: { welcome:'👋 Hallo! Willkommen beim Warsaw Events Bot! Bitte wähle deine Sprache:', lang_set:n=>`✅ Sprache auf ${n} eingestellt.`, choose_action:'Wochenend-Veranstaltungsliste von The-Warsaw', btn_events:'📋 The-Warsaw Wochenendliste', btn_picks:'⭐ Top-Tipps dieses Wochenende', btn_lang:'🌐 Sprache ändern', btn_stop:'⛔ Stop', stopped:'Bot gestoppt. Sende /start zum Fortfahren.', no_events:'Noch keine Events veröffentlicht.', no_picks:'Die Top-Tipps für dieses Wochenende werden noch vorbereitet.', header:'📅 <b>Aktuelle Events in Warschau:</b>', picks_header:'⭐ <b>Top-Tipps in Warschau an diesem Wochenende:</b>', footer:'Schönes Wochenende! 🌟', help:'📖 <b>Hilfe</b>\n\nBefehle:\n/start — Hauptmenü\n/language — Sprache ändern\n/help — diese Nachricht' },
};
const LANG_NAMES = { en:'English', pl:'Polski', be:'Беларуская', uk:'Українська', de:'Deutsch', ru:'Русский' };
const MYMEMORY_CODES = { ru:'ru-RU', en:'en-GB', pl:'pl-PL', de:'de-DE', be:'be-BY', uk:'uk-UA' };

function tr(lang, key, ...args) {
  const s = I18N[lang] || I18N.en;
  const v = s[key] ?? I18N.en[key];
  return typeof v === 'function' ? v(...args) : (v ?? key);
}

function langKeyboard() {
  return { inline_keyboard: [
    [{ text:'🇬🇧 English', callback_data:'lang:en' }, { text:'🇵🇱 Polski', callback_data:'lang:pl' }],
    [{ text:'🇧🇾 Беларуская', callback_data:'lang:be' }, { text:'🇺🇦 Українська', callback_data:'lang:uk' }],
    [{ text:'🇩🇪 Deutsch', callback_data:'lang:de' }, { text:'🇷🇺 Русский', callback_data:'lang:ru' }],
  ] };
}
function menuKeyboard(lang) {
  return { inline_keyboard: [
    [{ text: tr(lang,'btn_events'), callback_data:'menu:events' }],
    [{ text: tr(lang,'btn_picks'), callback_data:'menu:picks' }],
    [{ text: tr(lang,'btn_lang'), callback_data:'menu:lang' }, { text: tr(lang,'btn_stop'), callback_data:'menu:stop' }],
  ] };
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
const send = (token, chat_id, text, extra = {}) => tg(token, 'sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
const ack  = (token, id) => tg(token, 'answerCallbackQuery', { callback_query_id: id });

const feedOf = (name) => (FEEDS[name] ? name : null);
async function getEvent(kv, feed = DEFAULT_FEED) { return kv.get(FEEDS[feed].kv, { type: 'json' }); }
async function saveEvent(kv, data, feed = DEFAULT_FEED) { await kv.put(FEEDS[feed].kv, JSON.stringify(data)); }
async function getUserLang(kv, chatId) { return (await kv.get(`lang:${chatId}`)) || 'ru'; }

// GitHub's API rejects requests without a User-Agent.
const ghHeaders = (pat) => ({ Authorization: `token ${pat}`, Accept: 'application/vnd.github+json', 'User-Agent': 'warsaw-events-worker' });

async function fetchGithubJson(pat, feed = DEFAULT_FEED) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FEEDS[feed].file}`;
  const r = await fetch(url, { headers: ghHeaders(pat) });
  if (!r.ok) { console.error(`gh read ${FEEDS[feed].file}: HTTP ${r.status}`); return null; }
  const meta = await r.json();
  try { return JSON.parse(atob(meta.content.replace(/\n/g, ''))); } catch { return null; }
}

async function saveGithubJson(pat, data, feed = DEFAULT_FEED) {
  const file = FEEDS[feed].file;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${file}`;
  const r = await fetch(url, { headers: ghHeaders(pat) });
  if (!r.ok && r.status !== 404) { console.error(`gh save ${file}: read HTTP ${r.status}`); return; }
  const sha = r.ok ? (await r.json()).sha : undefined; // 404 = file doesn't exist yet
  const body = {
    message: `chore: update ${feed} events data`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    ...(sha ? { sha } : {}),
  };
  const w = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(pat), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!w.ok) console.error(`gh save ${file}: write HTTP ${w.status}`);
}

// ── Event-text parsing (mirrors legacy/database/db.py + legacy/handlers/menu.py) ─────────

function parseEvents(text) {
  if (!text) return { dateRange: null, items: [] };
  let dateRange = null, body = text;
  const firstSplit = text.split('\n\n', 1).length === 1 ? [text] : text.split(/\n\n(.*)/s).filter(Boolean);
  const parts = text.split(/\n\n/);
  if (parts.length >= 2 && !/^\d+\.\s/.test(parts[0].trim())) {
    dateRange = parts[0].trim();
    body = text.slice(text.indexOf('\n\n') + 2);
  } else if (!/^\d+\.\s/.test(text.split('\n')[0] || '') && text.split('\n')[0] && text.split('\n')[0].trim().length < 30 && text.includes('\n')) {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine) { dateRange = firstLine; body = text.slice(text.indexOf('\n') + 1).replace(/^\n+/, ''); }
  }
  const items = body.split(/\n+(?=\d+\.\s)/).map(i => i.replace(/\n\n/g, '\n').trim()).filter(Boolean);
  return { dateRange, items };
}

// ── Emoji assignment (union of all rules used historically) ────────────────

const EMOJI_RULES = [
  [['стендап','stand-up','standup','стэнд-ап','stand up'], '🎤'],
  [['свидани','blind date'], '💘'],
  [['варушняк','varušniak','kupalle','купалье'], '🔥'],
  [['ночь купал','купала на пляж'], '🌊'],
  [['парусн','регат','флот wiślanej'], '⛵'],
  [['wianki','wianek','gocławianki'], '🌿'],
  [['nightskating','найтскейтинг'], '🛼'],
  [['indian summer'], '🪘'],
  [['итальянской кухн','итальянск'], '🍕'],
  [['стритфуда','стритфуд','street food'], '🍔'],
  [['антикварн'], '🏺'],
  [['танц'], '💃'],
  [['бассейн'], '🏊'],
  [['кино под открытым небом','кинотеатр под'], '🎬'],
  [['vintage market','винтаж маркет'], '👗'],
  [['гаражная распродаж'], '🛒'],
  [['ярмарка растений'], '🌱'],
  [['ярмарка завтрак'], '☕'],
  [['nocny market','ночной маркет'], '🌙'],
  [['прогулка по саду','сад библиотек','buw'], '🌸'],
  [['туристическ линии','туристические лини'], '🚃'],
  [['фонтан','wielkie serca'], '⛲'],
  [['body worlds'], '🧠'],
  [['пикник'], '🧺'],
  [['уличного искусства','стрит-арт'], '🎨'],
  [['пивоварн','browar'], '🍺'],
  [['иммерсивн','immersive','lightshow','light show','genesis'], '✨'],
  [['мультимедийн'], '🎭'],
  [['выставка','экспозиц'], '🖼'],
  [['военный парад','парад'], '🎆'],
  [['концерт','concert'], '🎵'],
  [['фестиваль','festival'], '🎡'],
];
function assignEmoji(text) {
  return text.replace(/^(\d+)\.\s+🏠\s+(.+)$/gm, (_, n, title) => {
    const tl = title.toLowerCase();
    for (const [kws, emoji] of EMOJI_RULES) if (kws.some(k => tl.includes(k))) return `${n}. ${emoji} ${title}`;
    return `${n}. 🏠 ${title}`;
  });
}

// ── MyMemory translation (mirrors legacy/utils/translator.py) ─────────────────────

function chunkForTranslation(text, size = 1500) {
  const firstSplit = text.split('\n\n');
  let preamble = null, body = text;
  if (firstSplit.length >= 2 && !/^\d+\.\s/.test(firstSplit[0].trim())) {
    preamble = firstSplit[0].trim();
    body = text.slice(text.indexOf('\n\n') + 2);
  }
  const items = body.split(/\n+(?=\d+\.\s)/).map(i => i.trim()).filter(Boolean);
  if (!items.length) return text ? [text] : [];
  const chunks = [];
  let current = [], currentLen = preamble ? preamble.length + 2 : 0;
  for (const item of items) {
    const itemLen = item.length + 2;
    if (current.length && currentLen + itemLen > size) { chunks.push(current.join('\n\n')); current = []; currentLen = 0; }
    current.push(item); currentLen += itemLen;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  if (preamble && chunks.length) chunks[0] = preamble + '\n\n' + chunks[0];
  else if (preamble) return [preamble];
  return chunks;
}

async function translateChunk(chunk, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(langpair)}&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;
  const r = await fetch(url);
  const data = await r.json();
  const status = data.responseStatus || 0;
  const result = data.responseData?.translatedText || '';
  if (status === 200 && result) return result;
  return '';
}

async function translate(text, targetLang) {
  if (targetLang === SOURCE_LANG || !text.trim()) return text;
  const src = MYMEMORY_CODES[SOURCE_LANG] || SOURCE_LANG;
  const tgt = MYMEMORY_CODES[targetLang] || targetLang;
  const langpair = `${src}|${tgt}`;
  const chunks = chunkForTranslation(text);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(1000);
    const translated = await translateChunk(chunks[i], langpair);
    if (!translated) return null;
    results.push(translated);
  }
  return results.join('\n\n');
}

// ── Message splitting for Telegram's length limit ──────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function splitBlock(text, limit) {
  const out = []; let cur = '';
  for (const line of text.split('\n')) {
    if (line.length > limit) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      continue;
    }
    if (cur && cur.length + 1 + line.length > limit) { out.push(cur); cur = line; }
    else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out;
}
function buildChunks(blocks, limit, maxBlocks) {
  const chunks = []; let cur = '', n = 0;
  for (const b of blocks) {
    if (!b) continue;
    if (b.length > limit) {
      if (cur) { chunks.push(cur); cur = ''; n = 0; }
      const parts = splitBlock(b, limit);
      for (let i = 0; i < parts.length - 1; i++) chunks.push(parts[i]);
      cur = parts[parts.length - 1]; n = 1;
      continue;
    }
    if (cur && (cur.length + 2 + b.length > limit || n >= maxBlocks)) { chunks.push(cur); cur = ''; n = 0; }
    cur = cur ? cur + '\n\n' + b : b; n++;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
async function sendSafe(tok, chatId, text, extra) {
  extra = extra || {};
  let res = await send(tok, chatId, text, extra);
  if (!res.ok && res.parameters?.retry_after) { await sleep((res.parameters.retry_after + 1) * 1000); res = await send(tok, chatId, text, extra); }
  if (!res.ok) { const plain = Object.assign({ chat_id: chatId, text: text.replace(/<[^>]+>/g, '') }, extra); res = await tg(tok, 'sendMessage', plain); }
  if (!res.ok) console.error('send failed:', res.description);
  return res;
}

// ── GitHub cache helpers ────────────────────────────────────────────────────

async function persistToGithub(env, raw, translations, feed = DEFAULT_FEED) {
  try { await saveGithubJson(env.GITHUB_PAT, { raw, translations }, feed); }
  catch (e) { console.error('gh save:', e); }
}

// ── Telegram update handling ────────────────────────────────────────────────

async function handleUpdate(update, env, ctx) {
  const token = env.BOT_TOKEN, kv = env.EVENTS_KV;
  const channelUsername = env.CHANNEL_USERNAME || DEFAULT_CHANNEL;
  const adminId = Number(env.ADMIN_USER_ID || 0);

  // Channel posts from the source channel become the current week's event.
  if (update.channel_post) {
    const cp = update.channel_post;
    if (cp.chat?.username === channelUsername) {
      const text = cp.text || cp.caption || '';
      if (text.trim()) {
        const fullText = assignEmoji(text);
        const existing = (await getEvent(kv)) || {};
        const eventId = (existing.event_id || 0) + 1;
        await saveEvent(kv, { event_id: eventId, raw: fullText, translations: {} });
        ctx.waitUntil(persistToGithub(env, fullText, {}));
        console.log(`Stored channel post as event #${eventId}`);
      }
    }
    return;
  }

  if (update.message) {
    const { chat, text = '', from } = update.message;
    const chatId = chat.id, cmd = text.split(' ')[0].split('@')[0];

    if (cmd === '/myid') { await send(token, chatId, `Your Telegram user ID: <code>${from.id}</code>`); return; }

    // Any text from the admin (not a command) replaces the current event —
    // mirrors legacy/handlers/admin.py's manual-post workflow.
    if (adminId && from?.id === adminId && text.trim() && !text.startsWith('/')) {
      const fullText = assignEmoji(text);
      const existing = (await getEvent(kv)) || {};
      const eventId = (existing.event_id || 0) + 1;
      await saveEvent(kv, { event_id: eventId, raw: fullText, translations: {} });
      ctx.waitUntil(persistToGithub(env, fullText, {}));
      await send(token, chatId, `✅ Saved as event <b>#${eventId}</b>.\nUsers will now see this in their chosen language.`);
      return;
    }

    const lang = await getUserLang(kv, chatId);
    if (cmd === '/start') await send(token, chatId, tr(lang, 'welcome'), { reply_markup: langKeyboard() });
    else if (cmd === '/language') await send(token, chatId, '🌐 Choose your language:', { reply_markup: langKeyboard() });
    else if (cmd === '/help') await send(token, chatId, tr(lang, 'help'));
    return;
  }

  if (update.callback_query) {
    const cb = update.callback_query, chatId = cb.message.chat.id, data = cb.data;
    await ack(token, cb.id);
    let lang = await getUserLang(kv, chatId);

    if (data.startsWith('lang:')) {
      lang = data.split(':')[1];
      await kv.put(`lang:${chatId}`, lang);
      await send(token, chatId, tr(lang, 'lang_set', LANG_NAMES[lang] || lang), { reply_markup: menuKeyboard(lang) });
      return;
    }
    if (data === 'menu:lang') { await send(token, chatId, '🌐 Choose your language:', { reply_markup: langKeyboard() }); return; }
    if (data === 'menu:stop') { await send(token, chatId, tr(lang, 'stopped')); return; }
    if (data === 'menu:events' || data === 'menu:picks') {
      const feed = data === 'menu:picks' ? 'picks' : 'warsaw';
      const event = await getEvent(kv, feed);
      if (!event) { await send(token, chatId, tr(lang, feed === 'picks' ? 'no_picks' : 'no_events'), { reply_markup: menuKeyboard(lang) }); return; }

      let displayText = (lang === 'ru') ? event.raw : (event.translations || {})[lang];
      if (!displayText) {
        // No cached translation yet — try GitHub's cache first, then MyMemory.
        try {
          const gh = await fetchGithubJson(env.GITHUB_PAT, feed);
          if (gh?.raw?.slice(0, 100) === event.raw.slice(0, 100) && gh.translations?.[lang]) {
            displayText = gh.translations[lang];
          }
        } catch (e) { console.error('gh seed:', e); }
      }
      if (!displayText) {
        const result = await translate(event.raw, lang);
        displayText = result || event.raw;
        if (result) {
          event.translations = event.translations || {};
          event.translations[lang] = result;
          ctx.waitUntil(saveEvent(kv, event, feed).then(() => persistToGithub(env, event.raw, event.translations, feed)));
        }
      }

      const { dateRange, items } = parseEvents(displayText);
      const title = tr(lang, feed === 'picks' ? 'picks_header' : 'header');
      const header = dateRange ? (title + '\n' + escapeHtml(dateRange)) : title;
      const footer = tr(lang, 'footer');
      const blocks = [header].concat(items.map(escapeHtml)).concat([footer]);
      const chunks = buildChunks(blocks, TG_MAX_CHARS, ITEMS_PER_MSG + 1);
      const kb = { reply_markup: menuKeyboard(lang) };
      let kbSent = false;
      for (let i = 0; i < chunks.length; i++) {
        const last = i === chunks.length - 1;
        const res = await sendSafe(token, chatId, chunks[i], last ? kb : {});
        if (last && res?.ok) kbSent = true;
        if (!last) await sleep(150);
      }
      if (!kbSent) await sendSafe(token, chatId, tr(lang, 'choose_action'), kb);
    }
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname, method = request.method, kv = env.EVENTS_KV;

    if (path === '/webhook' && method === 'POST') {
      try { const update = await request.json(); await handleUpdate(update, env, ctx); }
      catch (e) { console.error('webhook:', e); }
      return new Response('ok');
    }

    if (path === '/events' && method === 'POST') {
      if (!env.WEBHOOK_SECRET || request.headers.get('X-Secret') !== env.WEBHOOK_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
      const data = await request.json();
      const feed = feedOf(data.feed || DEFAULT_FEED);
      if (!feed) return json({ ok: false, error: `unknown feed (use ${Object.keys(FEEDS).join(' or ')})` }, 400);
      const rawText = (data.date_range ? `${data.date_range}\n\n${data.text}` : data.text) || '';
      if (!rawText.trim()) return json({ ok: false, error: 'text required' }, 400);
      const fullText = assignEmoji(rawText);
      const existing = (await getEvent(kv, feed)) || {};
      const eventId = (existing.event_id || 0) + 1;
      let translations = {};
      if (existing.raw && existing.raw.slice(0, 100) === fullText.slice(0, 100)) {
        translations = existing.translations || {};
      } else {
        try {
          const gh = await fetchGithubJson(env.GITHUB_PAT, feed);
          if (gh?.raw?.slice(0, 100) === fullText.slice(0, 100)) translations = gh.translations || {};
        } catch (e) { console.error('gh seed:', e); }
      }
      await saveEvent(kv, { event_id: eventId, raw: fullText, translations }, feed);
      ctx.waitUntil(persistToGithub(env, fullText, translations, feed));
      return json({ ok: true, feed, event_id: eventId, mode: data.mode || 'replace', translations_loaded: Object.keys(translations).length });
    }

    if (path === '/translate' && method === 'POST') {
      if (!env.WEBHOOK_SECRET || request.headers.get('X-Secret') !== env.WEBHOOK_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
      const { lang, text, feed: feedName } = await request.json();
      const feed = feedOf(feedName || DEFAULT_FEED);
      if (!feed) return json({ ok: false, error: `unknown feed (use ${Object.keys(FEEDS).join(' or ')})` }, 400);
      if (!lang || !text) return json({ ok: false, error: 'lang and text required' }, 400);
      const event = await getEvent(kv, feed);
      if (!event) return json({ ok: false, error: 'no event' }, 404);
      event.translations = event.translations || {};
      event.translations[lang] = text;
      await saveEvent(kv, event, feed);
      ctx.waitUntil(persistToGithub(env, event.raw, event.translations, feed));
      return json({ ok: true, feed, lang, chars: text.length, events: (text.match(/^\d+\.\s/gm) || []).length });
    }

    if (path === '/events' && method === 'GET') {
      const feed = feedOf(url.searchParams.get('feed') || DEFAULT_FEED);
      if (!feed) return json({ ok: false, error: 'unknown feed' }, 400);
      const event = await getEvent(kv, feed);
      if (!event) return json({ ok: false, error: 'no events' }, 404);
      return json({ ok: true, event });
    }

    if (path === '/debug') {
      const summary = (ev) => ({
        event_id: ev?.event_id,
        raw_len: ev?.raw?.length || 0,
        translations: Object.fromEntries(Object.entries(ev?.translations || {}).map(([k, v]) => [k, `${(v.match(/^\d+\.\s/gm) || []).length}ev`])),
      });
      const event = await getEvent(kv);
      const picks = await getEvent(kv, 'picks');
      // Top-level fields describe the `warsaw` feed (unchanged for old callers).
      return json({
        version: VERSION,
        events_in_kv: event ? 1 : 0,
        ...summary(event),
        feeds: { warsaw: summary(event), picks: picks ? summary(picks) : null },
        github_pat_set: !!env.GITHUB_PAT,
        webhook_secret_set: !!env.WEBHOOK_SECRET,
        admin_id_set: !!env.ADMIN_USER_ID,
      });
    }

    if (path === '/health') return new Response(`ok (${VERSION})`);
    return json({ ok: false, error: 'not found' }, 404);
  },
};
