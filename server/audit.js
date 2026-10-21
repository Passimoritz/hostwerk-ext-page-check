'use strict';
/*
 * Page check without Hostwerk: fetch one page, read its HTML and rate speed, SEO and accessibility basics.
 * No browser needed – the checks work on the HTML the server sends (what search engines see first).
 */

const MAX_HTML = 5 * 1024 * 1024;
const MAX_LINKS = 40;
const MAX_SITE_LINKS = 200;
const AREAS = ['speed', 'seo', 'a11y', 'security'];

/** Adresse nur im eigenen Netz (localhost, *.localhost, *.test, private IPs)? Dort ist HTTPS noch keine Pflicht. */
function isLocal(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.test') || h.endsWith('.local') || h === '::1'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h);
}
/** Sieht eine Adresse nach einer HTML-Seite aus (nicht Bild, Skript, Download)? Für „Ganze Website prüfen“. */
const isPageUrl = (u) => !/\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|gz|mp4|webm|mp3|woff2?|ttf|eot|map)(\?|#|$)/i.test(String(u));

/** Very small HTML reader: tags with attributes and the text between them (enough for these checks). */
function parse(html) {
  const tags = [];
  const re = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
    while ((a = ar.exec(m[2] || ''))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    tags.push({ name: m[1].toLowerCase(), attrs, index: m.index, end: re.lastIndex });
  }
  return tags;
}
const strip = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** Inner text of the element that starts at tag t (until its closing tag). */
function inner(html, t) { const close = html.toLowerCase().indexOf(`</${t.name}`, t.end); return close < 0 ? '' : strip(html.slice(t.end, close)); }

/** Points per area (weighted share of passed checks) and the overall score. */
function scores(checks) {
  const area = (a) => { const xs = checks.filter((c) => c.area === a); const w = xs.reduce((n, c) => n + c.weight, 0); return w ? Math.round((xs.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0) / w) * 100) : 100; };
  const areas = Object.fromEntries(AREAS.map((a) => [a, area(a)]));
  return { score: Math.round(AREAS.reduce((n, a) => n + areas[a], 0) / AREAS.length), areas };
}

/**
 * Rate a fetched page. page = { url, status, headers, html, ttfbMs, totalMs, bytes }
 * → { score, areas: { speed, seo, a11y }, checks: [{ area, ok, weight, text, tip }], links: [urls on the same site] }
 */
function rate(page) {
  const { html = '', headers = {} } = page;
  const tags = parse(html);
  const find = (n) => tags.filter((t) => t.name === n);
  const meta = (key) => { const t = find('meta').find((x) => (x.attrs.name || x.attrs.property || '').toLowerCase() === key); return t ? t.attrs.content || '' : null; };
  const checks = [];
  const add = (area, ok, weight, text, tip) => checks.push({ area, ok: !!ok, weight, text, tip: ok ? null : tip });

  // Speed
  add('speed', page.ttfbMs < 600, 3, `First byte after ${page.ttfbMs} ms`, 'The server needs long before it answers – look at slow database queries or missing caching (the Profiler extension helps).');
  add('speed', page.totalMs < 2000, 2, `Page loaded in ${page.totalMs} ms`, 'The page takes long to load – make it smaller or faster on the server.');
  add('speed', page.bytes < 500 * 1024, 2, `HTML size ${Math.round(page.bytes / 1024)} KB`, 'The HTML is large – move big inline scripts/styles into files and load lists in parts.');
  const enc = String(headers['content-encoding'] || '');
  add('speed', /gzip|br|zstd/.test(enc) || page.bytes < 10 * 1024, 2, enc ? `Compressed (${enc})` : 'Not compressed', 'Switch on gzip or Brotli in the web server – the page gets 60–80 % smaller on the way.');
  const scripts = find('script').filter((t) => t.attrs.src && !('async' in t.attrs) && !('defer' in t.attrs) && t.attrs.type !== 'module');
  const headEnd = html.toLowerCase().indexOf('</head>');
  const blocking = scripts.filter((t) => headEnd < 0 || t.index < headEnd);
  add('speed', blocking.length === 0, 1, `${blocking.length} blocking script(s) in the head`, 'Add defer (or async) to scripts in the head, so the page can show before they are loaded.');
  const imgs = find('img');
  const noSize = imgs.filter((t) => !t.attrs.width || !t.attrs.height);
  add('speed', noSize.length === 0, 1, `${imgs.length - noSize.length} of ${imgs.length} images with width and height`, 'Give images width and height – then the page does not jump while loading.');

  // SEO
  const title = find('title')[0];
  const titleText = title ? inner(html, title) : '';
  add('seo', titleText.length >= 10 && titleText.length <= 65, 3, titleText ? `Title: “${titleText.slice(0, 70)}”` : 'No title', 'A title of 10–65 characters that says what the page is about – it is the blue line in search results.');
  const desc = meta('description');
  add('seo', desc && desc.length >= 50 && desc.length <= 160, 2, desc ? `Description with ${desc.length} characters` : 'No description', 'Add <meta name="description" content="…"> with 50–160 characters – search engines often show it under the title.');
  const h1 = find('h1');
  add('seo', h1.length === 1, 2, `${h1.length} main heading(s) (h1)`, 'Use exactly one <h1> per page with the main topic.');
  add('seo', !!find('link').find((t) => /canonical/i.test(t.attrs.rel || '')), 1, 'Canonical link', 'Add <link rel="canonical" href="…"> so search engines know the main address of the page.');
  add('seo', !!meta('og:title') || !!meta('og:image'), 1, 'Preview for social networks (Open Graph)', 'Add og:title, og:description and og:image – then shared links show a nice preview.');
  const robots = (meta('robots') || '') + String(headers['x-robots-tag'] || '');
  add('seo', !/noindex/i.test(robots), 2, /noindex/i.test(robots) ? 'Page is hidden from search engines (noindex)' : 'Visible to search engines', 'The page says “noindex” – fine for a test site, remove it before going live.');
  add('seo', !!find('meta').find((t) => (t.attrs.name || '').toLowerCase() === 'viewport'), 2, 'Viewport for phones', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> – otherwise phones show the desktop page tiny.');

  // Accessibility basics
  const htmlTag = find('html')[0];
  add('a11y', htmlTag && htmlTag.attrs.lang, 3, htmlTag && htmlTag.attrs.lang ? `Page language: ${htmlTag.attrs.lang}` : 'No page language', 'Add lang="de" (or your language) to <html> – screen readers then read with the right pronunciation.');
  const noAlt = imgs.filter((t) => t.attrs.alt === undefined);
  add('a11y', noAlt.length === 0, 3, `${imgs.length - noAlt.length} of ${imgs.length} images with alt text`, 'Give every image an alt text (empty alt="" for pure decoration) – for screen readers and when images do not load.');
  const fields = find('input').filter((t) => !/^(hidden|submit|button|image|reset)$/i.test(t.attrs.type || '')).concat(find('select'), find('textarea'));
  const labelFor = new Set(find('label').map((t) => t.attrs.for).filter(Boolean));
  const unlabelled = fields.filter((t) => !t.attrs['aria-label'] && !t.attrs['aria-labelledby'] && !(t.attrs.id && labelFor.has(t.attrs.id)) && !t.attrs.title);
  add('a11y', unlabelled.length === 0, 2, `${fields.length - unlabelled.length} of ${fields.length} form fields with a label`, 'Connect every field to a <label for="…"> (or aria-label) – a placeholder is not a label.');
  const links = find('a');
  const vague = links.filter((t) => /^(hier|here|mehr|more|klicken|click here|weiter|link)$/i.test(inner(html, t)));
  add('a11y', vague.length === 0, 1, `${vague.length} link(s) with vague text (“here”, “more”)`, 'Link texts should say where they lead (“Opening hours” instead of “here”).');
  const emptyBtn = find('button').filter((t) => !inner(html, t) && !t.attrs['aria-label'] && !t.attrs.title);
  add('a11y', emptyBtn.length === 0, 2, `${emptyBtn.length} button(s) without a name`, 'Buttons with only an icon need aria-label="…" – otherwise screen readers just say “button”.');
  const zoomOff = find('meta').find((t) => (t.attrs.name || '').toLowerCase() === 'viewport' && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(t.attrs.content || ''));
  add('a11y', !zoomOff, 2, zoomOff ? 'Zooming is switched off' : 'Zooming allowed', 'Remove user-scalable=no / maximum-scale=1 – people with poor eyesight need to zoom.');

  // Heading order: start with h1, never skip a level going down (h2 → h4)
  const heads = tags.filter((t) => /^h[1-6]$/.test(t.name)).map((t) => Number(t.name[1]));
  let jumps = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) jumps++;
  const headText = !heads.length ? 'No headings' : heads[0] !== 1 ? `First heading is h${heads[0]} instead of h1` : jumps ? `${jumps} skipped heading level(s) (e.g. h2 → h4)` : 'Heading order h1–h6 is fine';
  add('a11y', heads.length > 0 && heads[0] === 1 && jumps === 0, 1, headText, 'Build headings like a table of contents: one h1, below it h2, then h3 – without skipping a level. Screen reader users jump through the page by headings.');

  // Security headers – what the server sends with the page
  const H = (k) => String(headers[k] || '');
  const metaEquiv = (k) => { const t = find('meta').find((x) => (x.attrs['http-equiv'] || '').toLowerCase() === k); return t ? t.attrs.content || '' : ''; };
  let pu; try { pu = new URL(page.url); } catch { pu = null; }
  const https = !!pu && pu.protocol === 'https:';
  const local = !!pu && isLocal(pu.hostname);
  if (https) add('security', /max-age\s*=\s*[1-9]/i.test(H('strict-transport-security')), 2, H('strict-transport-security') ? 'HSTS is set' : 'No HSTS header', 'Send Strict-Transport-Security: max-age=31536000 – then browsers only ever use HTTPS for your site.');
  else add('security', local, 3, local ? 'Local test address – HTTPS not needed yet' : 'Page is served without HTTPS', 'Switch on HTTPS (certificate under Live → Domains & HTTPS) and redirect http:// to https://.');
  const csp = H('content-security-policy') || metaEquiv('content-security-policy');
  add('security', !!csp, 2, csp ? 'Content Security Policy is set' : 'No Content Security Policy', 'A Content-Security-Policy header says which scripts may run – it stops most injected code (XSS). Start with default-src \'self\'.');
  add('security', /nosniff/i.test(H('x-content-type-options')), 1, /nosniff/i.test(H('x-content-type-options')) ? 'X-Content-Type-Options: nosniff' : 'No X-Content-Type-Options', 'Send X-Content-Type-Options: nosniff – browsers then never treat an upload as a script.');
  const ref = H('referrer-policy') || (find('meta').find((t) => (t.attrs.name || '').toLowerCase() === 'referrer') || { attrs: {} }).attrs.content || '';
  add('security', !!ref, 1, ref ? `Referrer-Policy: ${ref.slice(0, 60)}` : 'No Referrer-Policy', 'Send Referrer-Policy: strict-origin-when-cross-origin – other sites then do not see full addresses of your pages.');
  const framed = /deny|sameorigin/i.test(H('x-frame-options')) || /frame-ancestors/i.test(csp);
  add('security', framed, 1, framed ? 'Protected against framing (clickjacking)' : 'Can be framed by other sites', 'Send X-Frame-Options: SAMEORIGIN (or frame-ancestors in the CSP) – then no other site can lay your page into a frame and trick clicks.');

  // Same-site links and images for the broken-link check
  let base; try { base = new URL(page.url); } catch { base = null; }
  const same = new Set();
  if (base) {
    for (const t of [...links.map((x) => x.attrs.href), ...imgs.map((x) => x.attrs.src)]) {
      if (!t || /^(#|mailto:|tel:|javascript:|data:)/i.test(t)) continue;
      try { const u = new URL(t, base); if (u.origin === base.origin) { u.hash = ''; if (u.toString() !== base.toString()) same.add(u.toString()); } } catch { /* ignore */ }
    }
  }

  return { ...scores(checks), checks, links: [...same].slice(0, MAX_LINKS), title: titleText };
}

/** Same-site links and images: HEAD, falls back to GET. → [{ url, status }] of the broken ones */
async function brokenLinks(urls, fetchFn = fetch, parallel = 8) {
  const broken = [];
  const list = [...new Set(urls)];
  for (let i = 0; i < list.length; i += parallel) {
    await Promise.all(list.slice(i, i + parallel).map(async (l) => {
      try {
        let x = await fetchFn(l, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (x.status === 405 || x.status === 501) x = await fetchFn(l, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (x.status >= 400) broken.push({ url: l, status: x.status });
      } catch { broken.push({ url: l, status: null }); }
    }));
  }
  return broken;
}

/**
 * robots.txt and sitemap.xml of the site. → { robots: bool, blocked: bool (Disallow: / for everyone), sitemap: bool, sitemapUrl }
 * The sitemap address comes from robots.txt ("Sitemap: …"), otherwise /sitemap.xml.
 */
async function siteFiles(origin, fetchFn = fetch) {
  const out = { robots: false, blocked: false, sitemap: false, sitemapUrl: `${origin}/sitemap.xml` };
  const text = async (u) => { const r = await fetchFn(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) }); return r.status === 200 ? (await r.text()).slice(0, 200000) : null; };
  try {
    const robots = await text(`${origin}/robots.txt`);
    if (robots != null && !/<html/i.test(robots)) {
      out.robots = true;
      // Gruppe für alle (User-agent: *) mit "Disallow: /" sperrt die ganze Seite
      let all = false;
      for (const raw of robots.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!m) continue;
        const k = m[1].toLowerCase(); const v = m[2].trim();
        if (k === 'user-agent') all = v === '*';
        else if (k === 'disallow' && all && v === '/') out.blocked = true;
        else if (k === 'sitemap' && /^https?:\/\//i.test(v) && out.sitemapUrl === `${origin}/sitemap.xml`) out.sitemapUrl = v;
      }
    }
  } catch { /* keine robots.txt */ }
  try { const sm = await text(out.sitemapUrl); out.sitemap = !!sm && /<(urlset|sitemapindex)\b/i.test(sm); } catch { /* keine Sitemap */ }
  return out;
}

/**
 * Fetch the page (time to first byte and total) and rate it; then check same-site links (HEAD, falls back to GET),
 * robots.txt and sitemap.xml. links: false skips the link check, files: false skips robots/sitemap (pages of a site check).
 */
async function check(url, { fetchFn = fetch, links = true, files = true } = {}) {
  let u; try { u = new URL(url); } catch { throw Object.assign(new Error('That is not a valid address (it must start with http:// or https://).'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Only http:// and https:// addresses are supported.'), { status: 400 });
  const t0 = Date.now();
  let res;
  try { res = await fetchFn(u.toString(), { headers: { 'user-agent': 'Hostwerk page check', 'accept-encoding': 'gzip, deflate, br' }, redirect: 'follow', signal: AbortSignal.timeout(30000) }); } catch (e) {
    throw Object.assign(new Error(/ECONNREFUSED|fetch failed/.test(String(e && (e.cause && e.cause.code || e.message))) ? 'Nothing answers at this address – is the web server running?' : 'The page did not answer in time.'), { status: 409 });
  }
  const ttfbMs = Date.now() - t0;
  const buf = Buffer.from(await res.arrayBuffer());
  const totalMs = Date.now() - t0;
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  const html = buf.subarray(0, MAX_HTML).toString('utf8');
  const r = rate({ url: res.url || u.toString(), status: res.status, headers, html, ttfbMs, totalMs, bytes: Number(headers['content-length']) || buf.length });
  if (res.status >= 400) r.checks.unshift({ area: 'speed', ok: false, weight: 0, text: `The page answers with status ${res.status}`, tip: 'Fix this first – the page itself is broken.' });
  let broken = [];
  if (files) {
    const f = await siteFiles(new URL(res.url || u.toString()).origin, fetchFn);
    r.checks.push({ area: 'seo', ok: f.robots, weight: 1, text: f.robots ? 'robots.txt found' : 'No robots.txt', tip: f.robots ? null : 'Put a robots.txt into the root folder – it tells search engines what they may read and where the sitemap is.' });
    if (f.robots) r.checks.push({ area: 'seo', ok: !f.blocked, weight: 2, text: f.blocked ? 'robots.txt blocks all search engines (Disallow: /)' : 'robots.txt lets search engines in', tip: f.blocked ? 'Fine for a test site – remove “Disallow: /” before going live.' : null });
    r.checks.push({ area: 'seo', ok: f.sitemap, weight: 1, text: f.sitemap ? 'Sitemap found' : 'No sitemap.xml', tip: f.sitemap ? null : 'A sitemap.xml lists every page – search engines then find new pages faster. Name it in robots.txt (Sitemap: …).' });
  }
  if (links) {
    broken = await brokenLinks(r.links, fetchFn);
    r.checks.push({ area: 'seo', ok: broken.length === 0, weight: 2, text: `${r.links.length - broken.length} of ${r.links.length} links and images on this site work`, tip: broken.length ? 'Fix or remove the broken links below.' : null });
  }
  return { url: res.url || u.toString(), status: res.status, t: Date.now(), ttfbMs, totalMs, bytes: buf.length, ...r, ...scores(r.checks), ...(res.status >= 400 ? { score: Math.min(scores(r.checks).score, 20) } : {}), broken };
}

/**
 * Whole website: start page plus up to max pages on the same site (breadth first, a few at a time), then every
 * same-site link and image of all pages checked once. onProgress(done, max, url) for the job.
 * → { url, t, score, areas, pages: [{ url, title, status, score, areas, failed }], broken, found }
 */
async function site(url, { fetchFn = fetch, max = 20, parallel = 3, onProgress = () => {} } = {}) {
  max = Math.max(1, Math.min(100, Number(max) || 20));
  const first = await check(url, { fetchFn, links: false, files: true });
  const results = [first];
  const seen = new Set([first.url, url]);
  const queue = first.links.filter(isPageUrl).filter((l) => !seen.has(l));
  queue.forEach((l) => seen.add(l));
  onProgress(1, max, first.url);
  while (queue.length && results.length < max) {
    const batch = queue.splice(0, Math.min(parallel, max - results.length));
    const got = await Promise.all(batch.map((l) => check(l, { fetchFn, links: false, files: false }).catch((e) => ({ url: l, error: e.message, links: [] }))));
    for (const g of got) {
      results.push(g);
      for (const l of g.links || []) if (isPageUrl(l) && !seen.has(l)) { seen.add(l); queue.push(l); }
      onProgress(results.length, max, g.url);
    }
  }
  const all = [...new Set(results.flatMap((x) => x.links || []))].slice(0, MAX_SITE_LINKS);
  const broken = await brokenLinks(all, fetchFn);
  const ok = results.filter((x) => !x.error);
  const avg = (f) => (ok.length ? Math.round(ok.reduce((n, x) => n + f(x), 0) / ok.length) : 0);
  const pages = results.map((x) => (x.error ? { url: x.url, failed: x.error } : { url: x.url, title: x.title, status: x.status, score: x.score, areas: x.areas, issues: x.checks.filter((c) => !c.ok).length }));
  return { url: first.url, t: Date.now(), score: avg((x) => x.score), areas: Object.fromEntries(AREAS.map((a) => [a, avg((x) => x.areas[a])])), pages: pages.sort((a, b) => (a.failed ? -1 : 0) - (b.failed ? -1 : 0) || (a.score ?? 0) - (b.score ?? 0)), broken, found: seen.size, linksChecked: all.length };
}

/**
 * Gate before publishing: check the page and say whether it reaches min points. min 0 = always passes.
 * → { ok, score, min, result }
 */
async function gate(url, { min = 0, fetchFn = fetch } = {}) {
  const result = await check(url, { fetchFn });
  const need = Math.max(0, Math.min(100, Number(min) || 0));
  return { ok: result.score >= need, score: result.score, min: need, result };
}

/** Ist der neue Wert schlechter geworden (für regelmäßige Prüfungen)? Ab drop Punkten weniger. */
function worse(prev, next, drop = 5) { return !!prev && !!next && Number.isFinite(prev.score) && Number.isFinite(next.score) && prev.score - next.score >= drop; }

module.exports = { parse, rate, check, scores, site, gate, worse, brokenLinks, siteFiles, isLocal, isPageUrl, AREAS };
