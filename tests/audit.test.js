'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const { rate, check, parse } = require('../server/audit');
const de = require('../locales/de.json');

const GOOD = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verein Sonnenschein – Termine und Kontakt</title><meta name="description" content="Alle Termine, Trainingszeiten und Ansprechpartner des Vereins Sonnenschein auf einen Blick.">
<link rel="canonical" href="https://example.org/"><meta property="og:title" content="Verein"><script src="/app.js" defer></script></head>
<body><h1>Willkommen</h1><img src="/logo.png" alt="Logo" width="10" height="10"><a href="/termine">Termine</a><label for="m">Mail</label><input id="m" type="email"><button>Senden</button></body></html>`;
const BAD = `<html><head><meta name="viewport" content="width=device-width, user-scalable=no"><script src="/x.js"></script><meta name="robots" content="noindex"></head>
<body><h1>A</h1><h1>B</h1><img src="/a.png"><a href="/missing">hier</a><input type="text" placeholder="Name"><button><svg></svg></button></body></html>`;
const page = (html, extra = {}) => ({ url: 'http://localhost:8080/', status: 200, headers: { 'content-encoding': 'gzip' }, html, ttfbMs: 50, totalMs: 120, bytes: html.length, ...extra });

test('a tidy page scores high, every check passes', () => {
  const r = rate(page(GOOD));
  assert.strictEqual(r.score, 100, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.deepStrictEqual(r.links.sort(), ['http://localhost:8080/logo.png', 'http://localhost:8080/termine']);
  assert.strictEqual(r.title, 'Verein Sonnenschein – Termine und Kontakt');
});

test('a sloppy page gets concrete tips in every area', () => {
  const r = rate(page(BAD, { ttfbMs: 1500, totalMs: 3000, headers: {} }));
  const failed = r.checks.filter((c) => !c.ok);
  for (const a of ['speed', 'seo', 'a11y']) assert.ok(r.areas[a] < 60, `${a}: ${r.areas[a]}`);
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
  for (const r of [rate(page(GOOD)), rate(page(BAD, { ttfbMs: 1500, totalMs: 3000, headers: {} }))]) for (const c of r.checks) { assert.ok(has(c.text), `text: ${c.text}`); if (c.tip) assert.ok(has(c.tip), `tip: ${c.tip}`); }
});
