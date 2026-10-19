'use strict';
/*
 * Page check – server part (SDK 2.7 native extension).
 *   POST /api/page-check/run      → { url } → result (score, areas, checks with tips, broken links)
 *   GET  /api/page-check          → { recent: [{ url, score, t }], targets: addresses of web servers / virtual hosts / apps }
 *   GET  /api/page-check/history  → ?url=… → the last 30 results of one address
 * Data: data/page-check/history.json
 */
const fs = require('fs');
const path = require('path');
const { check } = require('./audit');

function activate(host) {
  const { ctx } = host;
  const dir = path.join(ctx.paths.data, 'page-check');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'history.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = (v) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(v)); fs.renameSync(`${file}.tmp`, file); };
  const targets = () => {
    const out = [];
    for (const w of ctx.web ? ctx.web.list() : []) {
      if (!w.httpPort) continue;
      const port = w.httpPort === 80 ? '' : `:${w.httpPort}`;
      out.push({ label: w.name, url: `http://localhost${port}/` });
      for (const v of w.vhosts || []) out.push({ label: v.domain, url: `http://${v.domain}${port}/` });
    }
    for (const a of ctx.apps ? ctx.apps.list() : []) if (a.port) out.push({ label: `${a.name} (App)`, url: `http://localhost:${a.port}/` });
    return out;
  };

  host.router.get('/page-check', (req, res) => {
    const h = read();
    const recent = Object.entries(h).map(([url, list]) => ({ url, score: list[0] && list[0].score, t: list[0] && list[0].t })).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 20);
    res.json({ recent, targets: targets() });
  });
  host.router.get('/page-check/history', (req, res) => res.json((read()[String(req.query.url || '')] || []).map(({ checks, broken, links, ...rest }) => rest)));
  host.router.post('/page-check/run', async (req, res) => {
    const r = await check(String((req.body || {}).url || '').trim());
    const h = read();
    h[r.url] = [r, ...(h[r.url] || [])].slice(0, 30);
    write(h);
    res.json(r);
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
