'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const { rate, check, parse, site, gate, worse, siteFiles, isLocal } = require('../server/audit');
const de = require('../locales/de.json');

const GOOD = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verein Sonnenschein – Termine und Kontakt</title><meta name="description" content="Alle Termine, Trainingszeiten und Ansprechpartner des Vereins Sonnenschein auf einen Blick.">
<link rel="canonical" href="https://example.org/"><meta property="og:title" content="Verein"><script src="/app.js" defer></script></head>
<body><h1>Willkommen</h1><img src="/logo.png" alt="Logo" width="10" height="10"><a href="/termine">Termine</a><label for="m">Mail</label><input id="m" type="email"><button>Senden</button></body></html>`;
const BAD = `<html><head><meta name="viewport" content="width=device-width, user-scalable=no"><script src="/x.js"></script><meta name="robots" content="noindex"></head>
<body><h1>A</h1><h1>B</h1><h4>C</h4><img src="/a.png"><a href="/missing">hier</a><input type="text" placeholder="Name"><button><svg></svg></button></body></html>`;
const SAFE = { 'content-encoding': 'gzip', 'content-security-policy': "default-src 'self'; frame-ancestors 'self'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
const page = (html, extra = {}) => ({ url: 'http://localhost:8080/', status: 200, headers: SAFE, html, ttfbMs: 50, totalMs: 120, bytes: html.length, ...extra });

test('a tidy page scores high, every check passes', () => {
  const r = rate(page(GOOD));
  assert.strictEqual(r.score, 100, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.deepStrictEqual(r.links.sort(), ['http://localhost:8080/logo.png', 'http://localhost:8080/termine']);
  assert.strictEqual(r.title, 'Verein Sonnenschein – Termine und Kontakt');
});

test('a sloppy page gets concrete tips in every area', () => {
  const r = rate(page(BAD, { ttfbMs: 1500, totalMs: 3000, headers: {} }));
  const failed = r.checks.filter((c) => !c.ok);
  for (const a of ['speed', 'seo', 'a11y', 'security']) assert.ok(r.areas[a] < 60, `${a}: ${r.areas[a]}`);
  assert.ok(failed.every((c) => c.tip), 'every failed check has a tip');
  assert.ok(failed.some((c) => /noindex/.test(c.tip)) && failed.some((c) => /alt text/.test(c.tip)) && failed.some((c) => /zoom/.test(c.tip)));
});

test('parser copes with attributes in quotes, without quotes and without value', () => {
  const t = parse('<input id=x disabled type="text" data-a=\'1\'>');
  assert.deepStrictEqual(t[0].attrs, { id: 'x', disabled: '', type: 'text', 'data-a': '1' });
});

test('check: fetches, follows same-site links, finds the broken one, compression detected', async () => {
  const srv = http.createServer((q, res) => {
    if (q.url === '/') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync(GOOD.replace('/termine', '/missing'))); return; }
    if (q.url === '/logo.png') { res.writeHead(200); res.end('png'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const r = await check(`http://127.0.0.1:${srv.address().port}/`);
  srv.close();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.broken.map((b) => [b.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), b.status]), [['/missing', 404]]);
  assert.ok(r.checks.find((c) => /Compressed/.test(c.text)).ok);
  assert.ok(r.score < 100 && r.score > 70, String(r.score));
  await assert.rejects(check('http://127.0.0.1:1/'), /Nothing answers/);
  await assert.rejects(check('ftp://x/'), /http/);
});

test('every check text and tip has German (texts with numbers as patterns)', () => {
  const pats = (de.$patterns || []).map(([a]) => new RegExp(`^${a.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{\\\}|\{\}/g, '.+')}$`));
  const has = (s) => !!de[s] || pats.some((re) => re.test(s));
  const variants = [page(GOOD), page(BAD, { ttfbMs: 1500, totalMs: 3000, headers: {} }), page(GOOD, { url: 'https://example.org/', headers: {} }), page(GOOD, { url: 'https://example.org/', headers: { ...SAFE, 'strict-transport-security': 'max-age=1', 'x-frame-options': 'DENY' } }), page(GOOD, { url: 'http://example.org/' }), page('<h2>x</h2>'), page('<p>x</p>')];
  // Texte aus check() (robots.txt, Sitemap) – so, wie check() sie anhängt
  const extra = ['robots.txt found', 'No robots.txt', 'robots.txt blocks all search engines (Disallow: /)', 'robots.txt lets search engines in', 'Sitemap found', 'No sitemap.xml', 'Fine for a test site – remove “Disallow: /” before going live.'];
  for (const x of extra) assert.ok(has(x), x);
  for (const r of variants.map(rate)) for (const c of r.checks) { assert.ok(has(c.text), `text: ${c.text}`); if (c.tip) assert.ok(has(c.tip), `tip: ${c.tip}`); }
});

test('heading order: h1 first, no skipped levels', () => {
  const txt = (html) => rate(page(`<html lang="de"><body>${html}</body></html>`)).checks.find((c) => c.area === 'a11y' && /[Hh]eading/.test(c.text));
  assert.ok(txt('<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>').ok);
  assert.match(txt('<h1>A</h1><h2>B</h2><h4>C</h4>').text, /^1 skipped heading level/);
  assert.match(txt('<h2>A</h2><h3>B</h3>').text, /First heading is h2/);
  assert.strictEqual(txt('<p>x</p>').text, 'No headings');
});

test('security headers: an https page without headers fails, local http is fine, external http is not', () => {
  const bare = rate(page(GOOD, { url: 'https://example.org/', headers: { 'content-encoding': 'gzip' } }));
  const sec = bare.checks.filter((c) => c.area === 'security');
  assert.deepStrictEqual(sec.map((c) => c.ok), [false, false, false, false, false], sec.map((c) => c.text).join(' | '));
  const full = rate(page(GOOD, { url: 'https://example.org/', headers: { ...SAFE, 'strict-transport-security': 'max-age=31536000' } }));
  assert.strictEqual(full.areas.security, 100);
  assert.ok(!rate(page(GOOD, { url: 'http://example.org/' })).checks.find((c) => c.text === 'Page is served without HTTPS').ok);
  assert.ok(rate(page(GOOD, { url: 'http://shop.localhost:8080/' })).checks.find((c) => /Local test address/.test(c.text)).ok);
  // CSP as <meta http-equiv> counts too
  const meta = rate(page(GOOD.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'">'), { headers: {} }));
  assert.ok(meta.checks.find((c) => c.text === 'Content Security Policy is set').ok);
  assert.ok(isLocal('localhost') && isLocal('192.168.1.5') && isLocal('projekt.test') && !isLocal('example.org') && !isLocal('172.32.0.1'));
});

/** Kleine Website zum Testen: Startseite → zwei Unterseiten, eine kaputte Unterseite, robots.txt und sitemap.xml */
function testSite({ robots = 'User-agent: *\nDisallow:\nSitemap: /x', sitemap = true } = {}) {
  const pages = {
    '/': GOOD.replace('/termine', '/a').replace('<label', '<a href="/b">B</a><a href="/logo.png">L</a><label'),
    '/a': GOOD.replace('/termine', '/c'),
    '/b': GOOD.replace('/termine', '/kaputt'),
    '/c': GOOD,
  };
  return http.createServer((q, res) => {
    if (q.url === '/robots.txt' && robots != null) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(robots.replace('/x', `http://127.0.0.1:${q.socket.localPort}/sitemap.xml`)); return; }
    if (q.url === '/sitemap.xml' && sitemap) { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<?xml version="1.0"?><urlset><url><loc>/</loc></url></urlset>'); return; }
    if (pages[q.url]) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(pages[q.url]); return; }
    if (q.url === '/logo.png') { res.writeHead(200); res.end('png'); return; }
    res.writeHead(404); res.end();
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
/** Server sicher schließen – auch offene Keep-Alive-Verbindungen, sonst hängt der Testlauf */
const stop = (srv) => { srv.closeAllConnections(); srv.close(); };

test('robots.txt and sitemap.xml are checked (and a site-wide Disallow is caught)', async (t) => {
  let srv = testSite(); let base = await listen(srv);
  t.after(() => stop(srv));
  let f = await siteFiles(base);
  assert.deepStrictEqual({ robots: f.robots, blocked: f.blocked, sitemap: f.sitemap }, { robots: true, blocked: false, sitemap: true });
  const r = await check(`${base}/`, { links: false });
  assert.ok(r.checks.find((c) => c.text === 'Sitemap found').ok);
  stop(srv);
  srv = testSite({ robots: 'User-agent: *\nDisallow: /', sitemap: false }); base = await listen(srv);
  f = await siteFiles(base);
  assert.ok(f.blocked && !f.sitemap);
  stop(srv);
  srv = testSite({ robots: null, sitemap: false }); base = await listen(srv);
  const r2 = await check(`${base}/`, { links: false });
  assert.ok(!r2.checks.find((c) => c.text === 'No robots.txt').ok && !r2.checks.find((c) => c.text === 'No sitemap.xml').ok);
  stop(srv);
});

test('whole website: follows same-site pages up to the limit, checks every link once', async (t) => {
  const srv = testSite(); const base = await listen(srv);
  t.after(() => stop(srv));
  let calls = 0;
  const r = await site(`${base}/`, { max: 10, onProgress: () => { calls++; } });
  assert.deepStrictEqual(r.pages.map((p) => p.url.replace(base, '')).sort(), ['/', '/a', '/b', '/c', '/kaputt', '/termine']);
  assert.strictEqual(r.pages.find((p) => p.url.endsWith('/kaputt')).status, 404, 'a missing page shows up with its status');
  assert.deepStrictEqual(r.broken.map((b) => [b.url.replace(base, ''), b.status]).sort(), [['/kaputt', 404], ['/termine', 404]]);
  assert.ok(r.score > 0 && r.areas.security > 0 && calls >= 4);
  const two = await site(`${base}/`, { max: 2 });
  assert.strictEqual(two.pages.length, 2, 'limit holds');
  stop(srv);
});

test('gate before publishing and "worse" for regular checks', async (t) => {
  const srv = testSite(); const base = await listen(srv);
  t.after(() => stop(srv));
  const pass = await gate(`${base}/`, { min: 10 });
  const fail = await gate(`${base}/`, { min: 100 });
  assert.ok(pass.ok && !fail.ok && fail.score === pass.score && fail.min === 100);
  assert.ok((await gate(`${base}/`)).ok, 'min 0 = always passes');
  stop(srv);
  assert.ok(worse({ score: 90 }, { score: 84 }) && !worse({ score: 90 }, { score: 88 }) && !worse(null, { score: 1 }));
});
