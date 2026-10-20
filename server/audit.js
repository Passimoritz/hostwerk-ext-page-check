'use strict';
/*
 * Page check without Hostwerk: fetch one page, read its HTML and rate speed, SEO and accessibility basics.
 * No browser needed – the checks work on the HTML the server sends (what search engines see first).
 */

const MAX_HTML = 5 * 1024 * 1024;
const MAX_LINKS = 40;

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
  const areas = { speed: area('speed'), seo: area('seo'), a11y: area('a11y') };
  return { score: Math.round((areas.speed + areas.seo + areas.a11y) / 3), areas };
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

/** Fetch the page (time to first byte and total) and rate it; then check same-site links (HEAD, falls back to GET). */
async function check(url, { fetchFn = fetch, links = true } = {}) {
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
  const broken = [];
  if (links) {
    await Promise.all(r.links.map(async (l) => {
      try {
        let x = await fetchFn(l, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (x.status === 405 || x.status === 501) x = await fetchFn(l, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (x.status >= 400) broken.push({ url: l, status: x.status });
      } catch { broken.push({ url: l, status: null }); }
    }));
    r.checks.push({ area: 'seo', ok: broken.length === 0, weight: 2, text: `${r.links.length - broken.length} of ${r.links.length} links and images on this site work`, tip: broken.length ? 'Fix or remove the broken links below.' : null });
  }
  return { url: res.url || u.toString(), status: res.status, t: Date.now(), ttfbMs, totalMs, bytes: buf.length, ...r, ...scores(r.checks), ...(res.status >= 400 ? { score: Math.min(scores(r.checks).score, 20) } : {}), broken };
}

module.exports = { parse, rate, check, scores };
