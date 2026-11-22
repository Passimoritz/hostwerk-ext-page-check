/*
 * Page check – small helpers of the page that the tests use too (CommonJS, bundled into ui/index.js):
 *   kbText(bytes)          → "< 1" | "12" (size in KB for the result line – 0 KB was misleading)
 *   toMarkdown(r, o)       → Markdown report of one page check (for customers or the team)
 *   siteMarkdown(s, o)     → Markdown report of a whole website
 * o = { t: translate(text, vars), areas: [{ id, label }], when: (ts) => text } – texts come from the page (de/en).
 */
const id = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);

function kbText(bytes) {
  const n = Number(bytes) || 0;
  return n > 0 && n < 1024 ? '< 1' : String(Math.round(n / 1024));
}

const line = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function toMarkdown(r, { t = id, areas = [], when = (x) => new Date(x).toISOString() } = {}) {
  const out = [];
  out.push(`# ${t('Page check')}: ${line(r.title || r.url)}`, '');
  out.push(`- ${t('Address')}: ${r.url}`);
  if (r.t) out.push(`- ${t('Checked')}: ${when(r.t)}`);
  out.push(`- ${t('Score')}: **${r.score} / 100**${areas.filter((a) => r.areas && r.areas[a.id] != null).map((a) => ` · ${t(a.label)} ${r.areas[a.id]}`).join('')}`);
  if (r.status != null) out.push(`- ${t('Status {status} · {ttfb} ms to the first byte · {total} ms in total · {kb} KB', { status: r.status, ttfb: r.ttfbMs, total: r.totalMs, kb: kbText(r.bytes) })}`);
  for (const a of areas) {
    const list = (r.checks || []).filter((c) => c.area === a.id);
    if (!list.length) continue;
    out.push('', `## ${t(a.label)} (${r.areas && r.areas[a.id] != null ? r.areas[a.id] : '–'})`, '');
    for (const c of list) out.push(`- ${c.ok ? '✅' : '❌'} ${line(c.text)}${!c.ok && c.tip ? `  \n  ${line(c.tip)}` : ''}`);
  }
  if (r.broken && r.broken.length) {
    out.push('', `## ${t('Broken links and images')} (${r.broken.length})`, '');
    for (const b of r.broken) out.push(`- ${b.url} – ${b.status || t('No answer')}`);
  }
  return `${out.join('\n')}\n`;
}

function siteMarkdown(s, { t = id, areas = [], when = (x) => new Date(x).toISOString() } = {}) {
  const out = [`# ${t('Website check')}: ${s.url}`, ''];
  if (s.t) out.push(`- ${t('Checked')}: ${when(s.t)}`);
  out.push(`- ${t('Score')}: **${s.score} / 100**`);
  out.push(`- ${t('{n} pages checked · {found} found', { n: (s.pages || []).length, found: s.found })}`);
  out.push('', `| ${t('Page')} | ${t('Total')} | ${areas.map((a) => t(a.label)).join(' | ')} |`, `|---|---:|${areas.map(() => '---:').join('|')}|`);
  for (const p of s.pages || []) out.push(`| ${line(p.title || p.url).replace(/\|/g, '\\|')} | ${p.failed ? '–' : p.score} | ${areas.map((a) => (p.areas && p.areas[a.id] != null ? p.areas[a.id] : '–')).join(' | ')} |`);
  if (s.broken && s.broken.length) {
    out.push('', `## ${t('Broken links and images')} (${s.broken.length})`, '');
    for (const b of s.broken) out.push(`- ${b.url} – ${b.status || t('No answer')}`);
  }
  return `${out.join('\n')}\n`;
}

module.exports = { kbText, toMarkdown, siteMarkdown };
