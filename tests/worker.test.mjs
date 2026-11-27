// Offline test of cloudflare-worker/worker.js: fake KV, Telegram and GitHub.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/worker.js';

function setup() {
  const store = new Map(), sent = [], gh = new Map();
  const kv = {
    get: async (k, o) => { const v = store.get(k); return v == null ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    put: async (k, v) => { store.set(k, v); },
  };
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://api.telegram.org/')) {
      sent.push({ method: url.split('/').pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    if (url.startsWith('https://api.github.com/')) {
      assert.ok(init.headers['User-Agent'], 'GitHub calls need a User-Agent');
      const file = url.split('/contents/')[1];
      if ((init.method || 'GET') === 'PUT') { gh.set(file, JSON.parse(init.body)); return new Response('{}'); }
      return gh.has(file) ? new Response(JSON.stringify({ sha: 'x', content: gh.get(file).content })) : new Response('{}', { status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = { EVENTS_KV: kv, BOT_TOKEN: 't', WEBHOOK_SECRET: 's', GITHUB_PAT: 'p' };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const call = async (method, path, body, headers = {}) => {
    const res = await worker.fetch(new Request(`https://w.example${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
    }), env, ctx);
    await Promise.all(waits.splice(0));
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const press = (data, chatId = 7) => call('POST', '/webhook', { callback_query: { id: 'c', data, message: { chat: { id: chatId } } } });
  return { store, sent, gh, call, press, kv };
}

const RU = '1. 🎤 Концерт\nОписание\n🕐 Когда: сб\n📍 Где: Клуб\n🎫 Билеты: 50 zł';
const EN = 'November 13–15\n\n1. 🎤 Concert\nText\n🕐 When: Sat\n📍 Where: Club\n🎫 Tickets: 50 zł';

test('menu after language selection shows both lists', async () => {
  const t = setup();
  await t.press('lang:en');
  const kb = t.sent.find((m) => m.method === 'sendMessage').body.reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('menu:events') && data.includes('menu:picks'));
});

test('old API calls without feed still update the-warsaw list', async () => {
  const t = setup();
  assert.equal((await t.call('POST', '/events', { text: RU, date_range: '13–15 ноября' })).status, 401);
  const r = await t.call('POST', '/events', { text: RU, date_range: '13–15 ноября' }, { 'X-Secret': 's' });
  assert.equal(r.json.feed, 'warsaw');
  assert.ok(t.store.has('current_event') && !t.store.has('current_picks'));
  assert.ok(t.gh.has('data/events.json'));
});

test('picks feed is stored, translated and shown separately', async () => {
  const t = setup();
  await t.call('POST', '/events', { text: 'warsaw list', date_range: 'x' }, { 'X-Secret': 's' });
  const r = await t.call('POST', '/events', { feed: 'picks', text: RU, date_range: '13–15 ноября' }, { 'X-Secret': 's' });
  assert.equal(r.json.feed, 'picks');
  const tr = await t.call('POST', '/translate', { feed: 'picks', lang: 'en', text: EN }, { 'X-Secret': 's' });
  assert.equal(tr.json.events, 1);
  assert.ok(t.gh.has('data/picks.json'));
  const dbg = (await t.call('GET', '/debug')).json;
  assert.deepEqual(dbg.feeds.picks.translations, { en: '1ev' });
  assert.deepEqual(dbg.translations, {}); // top level = warsaw feed, unchanged
  await t.press('lang:en'); t.sent.length = 0;
  await t.press('menu:picks');
  const text = t.sent.map((m) => m.body.text).join('\n');
  assert.match(text, /Top picks in Warsaw/);
  assert.match(text, /Concert/);
  assert.doesNotMatch(text, /warsaw list/);
  for (const m of t.sent.filter((x) => x.method === 'sendMessage')) {
    assert.equal(m.body.link_preview_options?.is_disabled, true, 'messages must not get a link preview card');
  }
});

test('unknown feed is rejected; empty picks shows a friendly message', async () => {
  const t = setup();
  assert.equal((await t.call('POST', '/events', { feed: 'nope', text: RU }, { 'X-Secret': 's' })).status, 400);
  await t.press('menu:picks');
  assert.match(t.sent.at(-1).body.text, /готовится/);
});

test('GitHub backup keeps every translation when saves collide', async () => {
  const t = setup();
  // Stricter fake GitHub: a write with an out-of-date sha is refused with 409,
  // like the real API, and each write takes a moment so saves overlap.
  const files = new Map(); // file -> { sha, content }
  let n = 0;
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (!url.startsWith('https://api.github.com/')) return base(url, init);
    const file = url.split('/contents/')[1];
    const cur = files.get(file);
    if ((init.method || 'GET') === 'PUT') {
      await new Promise((r) => setTimeout(r, 30));
      const b = JSON.parse(init.body);
      const now = files.get(file); // check against the file as it is when the write lands
      if (now && b.sha !== now.sha) return new Response('{}', { status: 409 });
      files.set(file, { sha: `s${++n}`, content: b.content });
      return new Response('{}');
    }
    return cur ? new Response(JSON.stringify(cur)) : new Response('{}', { status: 404 });
  };
  const H = { 'X-Secret': 's' };
  assert.equal((await t.call('POST', '/events', { text: RU, date_range: '13–15 ноября' }, H)).status, 200);

  // A publish run posts the five translations back to back, so their
  // background GitHub saves overlap. Collect them and wait for all at the end.
  const langs = ['en', 'pl', 'be', 'uk', 'de'];
  const pending = [];
  const env = { EVENTS_KV: t.kv, BOT_TOKEN: 't', WEBHOOK_SECRET: 's', GITHUB_PAT: 'p' };
  for (const lang of langs) {
    const res = await worker.fetch(new Request('https://w.example/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ lang, text: EN }),
    }), env, { waitUntil: (p) => pending.push(p) });
    assert.equal(res.status, 200);
  }
  await Promise.all(pending);

  const saved = JSON.parse(Buffer.from(files.get('data/events.json').content, 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(saved.translations).sort(), [...langs].sort());
});
