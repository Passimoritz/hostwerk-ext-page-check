'use strict';
/*
 * Page check – server part (SDK 2.7 native extension).
 *   POST /api/page-check/run      → { url } → result (score, areas, checks with tips, broken links)
 *   POST /api/page-check/site     → { url, max } → { job } – whole website (up to max pages), result in the job
 *   GET  /api/page-check          → { recent, targets, config, sites } – addresses of web servers / virtual hosts / apps
 *   GET  /api/page-check/history  → ?url=… → the last 30 results of one address; DELETE ?url=… → forget that address
 *   PUT  /api/page-check/config   → { minScore, schedules: [{ url, every: 'day'|'week' }] }
 * For other extensions (host.use('pageCheck')): check(url), gate(url, { min }) – e.g. before publishing a site.
 * Regular checks run in the background; a drop of 5 points or more is reported (toast + watcher in Go live → Monitoring → Watchers).
 * Data: data/page-check/history.json, sites.json, config.json
 */
const fs = require('fs');
const path = require('path');
const { check, site, gate, worse } = require('./audit');

const HOUR = 3600e3;
const EVERY = { day: 24 * HOUR, week: 7 * 24 * HOUR };

/** Gespeicherte Einstellungen säubern: Mindestpunktzahl 0–100, Zeitpläne nur mit http(s)-Adresse und bekanntem Takt. */
function cleanConfig(c = {}) {
  const schedules = (Array.isArray(c.schedules) ? c.schedules : [])
    .filter((x) => x && /^https?:\/\//i.test(String(x.url || '')) && EVERY[x.every])
    .slice(0, 20)
    .map((x) => ({ url: String(x.url).trim().slice(0, 500), every: x.every, last: Number(x.last) || 0, score: Number.isFinite(x.score) ? x.score : null }));
  return { minScore: Math.max(0, Math.min(100, Math.round(Number(c.minScore) || 0))), schedules };
}
/** Welche Zeitpläne sind fällig? */
const due = (schedules, now = Date.now()) => schedules.filter((x) => now - (x.last || 0) >= EVERY[x.every]);

function activate(host) {
  const { ctx } = host;
  // Braucht Hostwerks Innenleben (Recht „native“) – abgeschottet (nicht aus dem Katalog) gibt es ctx nicht
  if (!ctx || !ctx.paths) throw new Error('Page check only runs as an official package from the Hostwerk catalog (it needs the "native" permission without sandbox).');
  const dir = path.join(ctx.paths.data, 'page-check');
  fs.mkdirSync(dir, { recursive: true });
  const readJson = (name, fb) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return fb; } };
  const writeJson = (name, v) => { const f = path.join(dir, name); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f); };
  const read = () => readJson('history.json', {});
  const config = () => cleanConfig(readJson('config.json', {}));
  const MAX_URLS = 100;
  const remember = (r) => {
    const h = read(); const before = (h[r.url] || [])[0] || null; h[r.url] = [r, ...(h[r.url] || [])].slice(0, 30);
    // höchstens 100 Adressen aufheben (die zuletzt geprüften) – sonst wächst history.json ohne Ende
    const keep = Object.entries(h).sort((a, b) => ((b[1][0] || {}).t || 0) - ((a[1][0] || {}).t || 0)).slice(0, MAX_URLS);
    writeJson('history.json', Object.fromEntries(keep)); return before;
  };
  const targets = () => {
    const out = [];
    for (const w of ctx.web ? ctx.web.list() : []) {
      if (!w.httpPort) continue;
      const port = w.httpPort === 80 ? '' : `:${w.httpPort}`;
      out.push({ label: w.name, url: `http://localhost${port}/`, web: w.id });
      for (const v of w.vhosts || []) out.push({ label: v.domain, url: `http://${v.domain}${port}/`, web: w.id });
    }
    for (const a of ctx.apps ? ctx.apps.list() : []) if (a.port) out.push({ label: `${a.name} (App)`, url: `http://localhost:${a.port}/`, app: a.id });
    return out;
  };
  const recentOf = (h) => Object.entries(h).map(([url, list]) => ({ url, score: list[0] && list[0].score, t: list[0] && list[0].t })).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 20);
  const watch = (state, detail) => { try { if (host.watcher) host.watcher({ id: 'page-check', label: host.t('Page check'), state, detail, href: '#/ext/page-check' }); } catch { /* Wächter optional */ } };

  host.router.get('/page-check', (req, res) => {
    const h = read();
    const recent = recentOf(h);
    const sites = Object.values(readJson('sites.json', {})).map(({ url, t, score, pages }) => ({ url, t, score, pages: (pages || []).length })).sort((a, b) => b.t - a.t).slice(0, 10);
    res.json({ recent, targets: targets(), config: config(), sites });
  });
  // Eine Adresse aus „Schon geprüft“ entfernen (samt ihrem Verlauf), z. B. nach einem Tippfehler
  host.router.delete('/page-check/history', (req, res) => {
    const url = String(req.query.url || ''); const h = read();
    if (!h[url]) throw host.error(404, 'This address is not in the list.');
    delete h[url]; writeJson('history.json', h);
    res.json({ recent: recentOf(h) });
  });
  host.router.get('/page-check/history', (req, res) => res.json((read()[String(req.query.url || '')] || []).map(({ checks, broken, links, ...rest }) => rest))); // eslint-disable-line no-unused-vars
  host.router.post('/page-check/run', async (req, res) => {
    const r = await check(String((req.body || {}).url || '').trim());
    remember(r);
    res.json(r);
  });
  host.router.get('/page-check/site', (req, res) => res.json(readJson('sites.json', {})[String(req.query.url || '')] || null));
  host.router.post('/page-check/site', (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw host.error(400, 'Please enter the address of the page (http://…).');
    const max = Math.max(1, Math.min(100, Number((req.body || {}).max) || 20));
    const { runJob } = host.core('jobs');
    const job = runJob(host.t('Website check: {url}', { url }), async (j) => {
      let r;
      // Fehlertext übersetzt in die Aufgabenliste (sonst stand dort „Nothing answers …“ auf Englisch)
      try { r = await site(url, { max, onProgress: (n, of, u) => j.progress(Math.min(95, Math.round((n / of) * 90)), host.t('Checking {url} …', { url: u })) }); } catch (e) { throw Object.assign(new Error(host.t(e.message)), { status: e.status }); }
      const all = readJson('sites.json', {});
      all[r.url] = r;
      // höchstens 10 Websites aufheben (die neuesten)
      const keep = Object.values(all).sort((a, b) => b.t - a.t).slice(0, 10);
      writeJson('sites.json', Object.fromEntries(keep.map((x) => [x.url, x])));
      return r;
    }, { key: `page-check-site-${url}` });
    res.json({ job: job.id });
  });
  host.router.put('/page-check/config', (req, res) => {
    const old = config();
    const next = cleanConfig(req.body || {});
    // Stand bisheriger Zeitpläne behalten (letzte Prüfung, Punkte)
    next.schedules = next.schedules.map((x) => ({ ...x, ...(old.schedules.find((o) => o.url === x.url) || {}), every: x.every }));
    writeJson('config.json', next);
    res.json(next);
  });

  // Für andere Erweiterungen: prüfen und „reicht die Punktzahl zum Veröffentlichen?“
  host.provide('pageCheck', {
    check: async (url) => { const r = await check(url); remember(r); return r; },
    gate: async (url, opts = {}) => {
      const min = opts.min != null ? opts.min : config().minScore;
      const g = await gate(url, { min });
      remember(g.result);
      return { ok: g.ok, score: g.score, min: g.min, text: g.ok ? '' : host.t('Score {score} is below the minimum of {min} for publishing.', { score: g.score, min: g.min }) };
    },
    minScore: () => config().minScore,
  });

  // Regelmäßige Prüfungen: stündlich nachsehen, was fällig ist; schlechter geworden → melden
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const cfg = config();
      for (const s of due(cfg.schedules)) {
        let r;
        try { r = await check(s.url); } catch (e) { watch('alert', `${s.url}: ${e.message}`); s.last = Date.now(); continue; }
        const before = remember(r);
        s.last = Date.now(); s.score = r.score;
        if (worse(before, r)) {
          const text = host.t('Page check: {url} dropped from {from} to {to} points', { url: r.url, from: before.score, to: r.score });
          host.broadcast({ type: 'toast', kind: 'warn', text });
          watch('alert', text);
        } else watch('ok', host.t('{score} points – stable', { score: r.score }));
      }
      // Nur Stand (letzte Prüfung, Punkte) zurückschreiben – was währenddessen gespeichert wurde, bleibt
      const now = config();
      now.schedules = now.schedules.map((x) => { const d = cfg.schedules.find((o) => o.url === x.url); return d ? { ...x, last: d.last, score: d.score } : x; });
      writeJson('config.json', now);
    } finally { busy = false; }
  }
  if (!process.env.HW_TEST) {
    const first = setTimeout(() => tick().catch(() => {}), 5 * 60e3);
    const timer = setInterval(() => tick().catch(() => {}), HOUR);
    if (first.unref) first.unref();
    if (timer.unref) timer.unref();
    host.on('shutdown', () => { clearTimeout(first); clearInterval(timer); });
  }
}

function deactivate() {}

module.exports = { activate, deactivate, cleanConfig, due };
