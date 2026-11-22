'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
process.env.HW_TEST = '1';
const srvMod = require('../server/index.js');

/** Hostwerk-Double: sammelt Routen und Dienste, Texte unverändert (englisch). */
function fakeHost(data) {
  const routes = {};
  const r = {}; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (p, fn) => { routes[`${m.toUpperCase()} ${p}`] = fn; };
  const provided = {};
  const jobs = [];
  const host = {
    ctx: { paths: { data }, web: { list: () => [{ id: 'w1', name: 'Apache', httpPort: 8080, vhosts: [{ domain: 'shop.localhost' }] }] }, apps: { list: () => [{ id: 'a1', name: 'API', port: 3001 }] } },
    router: r, t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s),
    error: (status, text) => Object.assign(new Error(text), { status }), provide: (n, o) => { provided[n] = o; return o; }, on: () => {}, broadcast: () => {},
    core: () => ({ runJob: (title, fn) => { const job = { id: `j${jobs.length + 1}`, title, promise: fn({ progress: () => {} }) }; jobs.push(job); return job; } }),
  };
  const call = async (key, body = {}, query = {}) => { let out; await routes[key]({ body, query }, { json: (x) => { out = x; } }); return out; };
  return { host, routes, provided, call, jobs };
}

test('config: cleaned, kept between saves, targets of web servers and apps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const h = fakeHost(dir);
  srvMod.activate(h.host);
  const saved = await h.call('PUT /page-check/config', { minScore: 70, schedules: [{ url: 'http://localhost:8080/', every: 'day' }, { url: 'javascript:alert(1)', every: 'day' }] });
  assert.deepStrictEqual(saved.schedules.map((x) => x.url), ['http://localhost:8080/']);
  const st = await h.call('GET /page-check');
  assert.strictEqual(st.config.minScore, 70);
  assert.deepStrictEqual(st.targets.map((x) => x.url), ['http://localhost:8080/', 'http://shop.localhost:8080/', 'http://localhost:3001/']);
  await assert.rejects(h.call('POST /page-check/site', { url: 'ftp://x' }), /address/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('service for other extensions: gate uses the minimum score and remembers the result', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const web = http.createServer((q, res) => { res.writeHead(q.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); res.end('<html lang="de"><head><title>Hallo Welt – eine Testseite</title></head><body><h1>Hi</h1></body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  t.after(() => { web.closeAllConnections(); web.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${web.address().port}/`;
  const h = fakeHost(dir);
  srvMod.activate(h.host);
  assert.ok(h.provided.pageCheck, 'pageCheck is provided');
  await h.call('PUT /page-check/config', { minScore: 100 });
  const g = await h.provided.pageCheck.gate(url);
  assert.strictEqual(g.ok, false); assert.strictEqual(g.min, 100); assert.match(g.text, /below the minimum of 100/);
  assert.ok((await h.provided.pageCheck.gate(url, { min: 0 })).ok);
  const hist = await h.call('GET /page-check/history', {}, { url });
  assert.strictEqual(hist.length, 2, 'both checks are in the history');
  // Ganze Website als Aufgabe (Job): Ergebnis wird aufgehoben
  const started = await h.call('POST /page-check/site', { url, max: 3 });
  assert.strictEqual(started.job, 'j1');
  const siteResult = await h.jobs[0].promise;
  assert.strictEqual(siteResult.pages.length, 1);
  assert.strictEqual((await h.call('GET /page-check/site', {}, { url })).url, url);
  assert.strictEqual((await h.call('GET /page-check')).sites.length, 1);
});

test('due: daily and weekly schedules', () => {
  const now = Date.now();
  assert.deepStrictEqual(srvMod.due([{ url: 'a', every: 'day', last: now - 25 * 3600e3 }, { url: 'b', every: 'day', last: now - 3600e3 }, { url: 'c', every: 'week', last: now - 8 * 86400e3 }], now).map((x) => x.url), ['a', 'c']);
});

test('history: one address can be removed from "Checked before" (typo addresses), unknown → 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  fs.mkdirSync(path.join(dir, 'page-check'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page-check', 'history.json'), JSON.stringify({ 'http://tippfehler.locahost/': [{ url: 'http://tippfehler.locahost/', score: 0, t: 2 }], 'http://ok.localhost/': [{ url: 'http://ok.localhost/', score: 90, t: 1 }] }));
  const h = fakeHost(dir);
  srvMod.activate(h.host);
  assert.strictEqual((await h.call('GET /page-check')).recent.length, 2);
  const r = await h.call('DELETE /page-check/history', {}, { url: 'http://tippfehler.locahost/' });
  assert.deepStrictEqual(r.recent.map((x) => x.url), ['http://ok.localhost/']);
  assert.deepStrictEqual((await h.call('GET /page-check')).recent.map((x) => x.url), ['http://ok.localhost/']);
  await assert.rejects(h.call('DELETE /page-check/history', {}, { url: 'http://nie.localhost/' }), (e) => e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report helpers: size under 1 KB, Markdown report of a page and of a site', () => {
  const { kbText, toMarkdown, siteMarkdown } = require('../ui/src/report.js');
  assert.strictEqual(kbText(300), '< 1'); assert.strictEqual(kbText(0), '0'); assert.strictEqual(kbText(5000), '5');
  const areas = [{ id: 'seo', label: 'Search engines' }, { id: 'speed', label: 'Speed' }];
  const md = toMarkdown({ url: 'http://x.localhost/', title: 'Start | Shop', t: 1, score: 72, areas: { seo: 50, speed: 95 }, status: 200, ttfbMs: 3, totalMs: 9, bytes: 512, checks: [{ area: 'seo', ok: false, text: 'No description', tip: 'Add a meta description.' }, { area: 'seo', ok: true, text: 'Has a title' }, { area: 'speed', ok: true, text: 'Small page' }], broken: [{ url: 'http://x.localhost/a.png', status: 404 }] }, { areas, when: () => 'heute' });
  assert.match(md, /^# Page check: Start \| Shop/);
  assert.match(md, /\*\*72 \/ 100\*\* · Search engines 50 · Speed 95/);
  assert.match(md, /< 1 KB/);
  assert.match(md, /## Search engines \(50\)\n\n- ❌ No description {2}\n {2}Add a meta description\.\n- ✅ Has a title/);
  assert.match(md, /## Broken links and images \(1\)\n\n- http:\/\/x\.localhost\/a\.png – 404/);
  const smd = siteMarkdown({ url: 'http://x.localhost/', score: 80, found: 3, pages: [{ url: 'http://x.localhost/', title: 'A|B', score: 80, areas: { seo: 70 } }, { url: 'http://x.localhost/b', failed: 'timeout' }], broken: [] }, { areas });
  assert.match(smd, /\| A\\\|B \| 80 \| 70 \| – \|/);
  assert.match(smd, /\| http:\/\/x\.localhost\/b \| – \| – \| – \|/);
});

test('new texts have German', () => {
  const de = require('../locales/de.json');
  for (const s of ['Copy as report', 'Report copied (Markdown)', 'Only failed checks', '{n} of {all} need work', 'All checks passed', 'Remove from the list', 'Remove {url} from the list', 'This address is not in the list.', 'Page check', 'Address', 'Checked', 'Score', 'Website check', 'Page', 'Total', 'Broken links and images', 'No answer']) assert.ok(de[s], s);
});
