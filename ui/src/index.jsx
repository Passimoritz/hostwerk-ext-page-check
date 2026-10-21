import { useEffect, useState } from 'react';
import { FileSearch, Play, CheckCircle2, XCircle, Gauge, Search, Accessibility, Link2Off, History, ShieldCheck, Globe, CalendarClock, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { get, post, put, useApi, waitJob, fmtDate } from '@hostwerk/api';
import { Btn, Seg, Empty, Loading, Callout, Sparkline, InfoTip, toast } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import './style.css';

/*
 * Page check: address at the top (or one click on a web server / virtual host), then the score per area, every check
 * with a plain tip, broken links, and the history of that address. "Whole website" follows the links of the site up to
 * N pages. Below: regular checks (with a message when the score drops) and the minimum score before publishing.
 * Also as a tab on every project and in the web server area.
 * Texts are English; German comes from locales/de.json (also inside JSX).
 */
const AREAS = [
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'seo', label: 'Search engines', icon: Search },
  { id: 'a11y', label: 'Accessibility', icon: Accessibility },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];
const tone = (n) => (n >= 90 ? 'ok' : n >= 60 ? 'warn' : 'err');
const area = (r, id) => (r.areas && r.areas[id] != null ? r.areas[id] : null);

function Ring({ value, label }) {
  const r = 26; const c = 2 * Math.PI * r;
  return (
    <div className={`pc-ring pc-${tone(value)}`} role="img" aria-label={`${label}: ${value} / 100`}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r={r} className="pc-ring-bg" /><circle cx="32" cy="32" r={r} className="pc-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} /></svg>
      <b>{value}</b>
      <span className="tiny muted">{label}</span>
    </div>
  );
}

function Rings({ r }) {
  return (
    <>
      <Ring value={r.score} label="Total" />
      {AREAS.filter((a) => area(r, a.id) != null).map((a) => <Ring key={a.id} value={area(r, a.id)} label={a.label} />)}
    </>
  );
}

function Broken({ list }) {
  if (!list || !list.length) return null;
  return (
    <div className="card">
      <div className="card-head"><Link2Off size={16} /><h3>Broken links and images</h3><span className="badge err">{list.length}</span></div>
      <ul className="pc-broken">{list.map((b) => <li key={b.url}><code className="ellipsis">{b.url}</code><span className="badge err">{b.status || 'No answer'}</span></li>)}</ul>
    </div>
  );
}

function Result({ r }) {
  const [hist, setHist] = useState([]);
  useEffect(() => { get(`/page-check/history?url=${encodeURIComponent(r.url)}`).then(setHist).catch(() => setHist([])); }, [r.url, r.t]);
  return (
    <div className="stack">
      <div className="card"><div className="card-body pc-head">
        <Rings r={r} />
        <div className="grow stack pc-meta">
          <b className="ellipsis">{r.title || r.url}</b>
          <span className="small muted ellipsis">{r.url}</span>
          <span className="small muted">Status {r.status} · {r.ttfbMs} ms to the first byte · {r.totalMs} ms in total · {Math.round(r.bytes / 1024)} KB</span>
          {hist.length > 1 && <div className="row-tight"><History size={13} className="muted" /><Sparkline data={hist.slice().reverse().map((x) => x.score)} /><span className="tiny muted">Score over the last {hist.length} checks</span></div>}
        </div>
      </div></div>
      <div className="grid grid-2">
        {AREAS.filter((a) => r.checks.some((c) => c.area === a.id)).map((a) => (
          <div key={a.id} className="card">
            <div className="card-head"><a.icon size={16} /><h3>{a.label}</h3><span className={`badge ${tone(area(r, a.id))}`}>{area(r, a.id)}</span></div>
            <ul className="pc-checks">
              {r.checks.filter((c) => c.area === a.id).map((c, i) => (
                <li key={i} className={c.ok ? 'ok' : 'bad'}>
                  {c.ok ? <CheckCircle2 size={15} className="c-ok" aria-label="passed" /> : <XCircle size={15} className="c-err" aria-label="needs work" />}
                  <div><div className="small">{c.text}</div>{c.tip && <div className="tiny muted">{c.tip}</div>}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Broken list={r.broken} />
    </div>
  );
}

/** Whole website: one row per page (worst first), click checks that page in detail. */
function SiteResult({ s, onPick }) {
  return (
    <div className="stack">
      <div className="card"><div className="card-body pc-head">
        <Rings r={s} />
        <div className="grow stack pc-meta">
          <b className="ellipsis">{s.url}</b>
          <span className="small muted">{t('{n} pages checked · {found} found', { n: s.pages.length, found: s.found })}</span>
          <span className="small muted">{t('{ok} of {all} links and images work', { ok: s.linksChecked - s.broken.length, all: s.linksChecked })}</span>
          <span className="tiny muted">{fmtDate(s.t)}</span>
        </div>
      </div></div>
      <div className="card">
        <div className="card-head"><Globe size={16} /><h3>Pages of the site</h3></div>
        <table className="table pc-pages"><thead><tr><th>Page</th><th className="num">Total</th>{AREAS.map((a) => <th key={a.id} className="num">{a.label}</th>)}<th /></tr></thead><tbody>
          {s.pages.map((p) => (
            <tr key={p.url}>
              <td><div className="small ellipsis" title={p.url}>{p.title || p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</div>{p.failed ? <div className="tiny c-err">{p.failed}</div> : p.status >= 400 ? <div className="tiny c-err">{t('The page answers with status {status}', { status: p.status })}</div> : null}</td>
              <td className="num">{p.failed ? '–' : <span className={`badge ${tone(p.score)}`}>{p.score}</span>}</td>
              {AREAS.map((a) => <td key={a.id} className="num small">{p.areas ? p.areas[a.id] : '–'}</td>)}
              <td className="right"><Btn className="xs ghost" title="Check this page" aria-label="Check this page" icon={Search} onClick={() => onPick(p.url)} /></td>
            </tr>
          ))}
        </tbody></table>
      </div>
      <Broken list={s.broken} />
    </div>
  );
}

/** Regular checks and the minimum score before publishing. */
function Settings({ config, url, onSaved }) {
  const [every, setEvery] = useState('week');
  const [min, setMin] = useState(config.minScore || 0);
  useEffect(() => { setMin(config.minScore || 0); }, [config.minScore]);
  const save = async (next) => { try { onSaved(await put('/page-check/config', next)); toast.success(t('Saved')); } catch (e) { toast.error(e); } };
  const has = url && config.schedules.some((x) => x.url === url);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><CalendarClock size={16} /><h3>Regular checks</h3><InfoTip title="Regular checks">Hostwerk checks these addresses on its own and tells you when the score drops by 5 points or more.</InfoTip></div>
        <div className="card-body stack pc-gap">
          {config.schedules.length === 0 ? <span className="small muted">No regular checks yet.</span> : config.schedules.map((x) => (
            <div key={x.url} className="row-tight">
              <span className="grow small ellipsis" title={x.url}>{x.url}</span>
              <span className="badge">{x.every === 'day' ? 'Daily' : 'Weekly'}</span>
              {x.last ? <span className="tiny muted">{t('Checked {when} · {score} points', { when: fmtDate(x.last), score: x.score ?? '–' })}</span> : <span className="tiny muted">Not checked yet</span>}
              <Btn className="xs ghost" icon={Trash2} title="Remove" aria-label="Remove" onClick={() => save({ ...config, schedules: config.schedules.filter((y) => y.url !== x.url) })} />
            </div>
          ))}
          {url && !has && (
            <div className="row-tight">
              <Seg value={every} onChange={setEvery} options={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }]} />
              <Btn className="sm" icon={CalendarClock} onClick={() => save({ ...config, schedules: [...config.schedules, { url, every }] })}>Check regularly</Btn>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><ShieldCheck size={16} /><h3>Before publishing</h3><InfoTip title="Minimum score">Publishing extensions (e.g. “Publish pages”) check the page first and stop below this score. 0 = off.</InfoTip></div>
        <div className="card-body row-tight">
          <label className="small" htmlFor="pc-min">Minimum score</label>
          <input id="pc-min" className="input pc-min" type="number" min="0" max="100" value={min} onChange={(e) => setMin(e.target.value)} />
          <Btn className="sm" onClick={() => save({ ...config, minScore: Number(min) || 0 })}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

/** The whole tool – as its own page, in the web server area (embedded) or with a fixed list of addresses (project tab). */
function PageCheckView({ embedded = false, start = '', targets: fixed = null }) {
  const st = useApi('/page-check', [], { live: false });
  const [url, setUrl] = useState(start);
  const [mode, setMode] = useState('page');
  const [max, setMax] = useState(20);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const [s, setS] = useState(null);
  const run = async (u = url, m = mode) => {
    if (!String(u).trim()) return;
    setUrl(u); setBusy(true);
    try {
      if (m === 'site') { const j = await post('/page-check/site', { url: u, max }); const done = await waitJob(j.job); setS(done.result); setR(null); } else { setR(await post('/page-check/run', { url: u })); setS(null); }
      st.reload({ silent: true });
    } catch (e) { toast.error(e); }
    setBusy(false);
  };
  const d = st.data || { recent: [], targets: [], config: { minScore: 0, schedules: [] }, sites: [] };
  const targets = fixed || d.targets;
  if (st.error && !st.data) return <Empty icon={AlertTriangle} title="Could not load the page check" text={st.error} action={<Btn icon={RefreshCw} onClick={() => st.reload()}>Try again</Btn>} />;
  return (
    <div className="stack">
      <div className={`card ${embedded ? '' : 'mb'}`}><div className="card-body stack pc-gap">
        <form className="row-tight pc-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <Seg value={mode} onChange={setMode} options={[{ id: 'page', label: 'This page', icon: FileSearch }, { id: 'site', label: 'Whole website', icon: Globe }]} />
          <input className="input grow mono" value={url} aria-label="Address of the page" placeholder="http://meinprojekt.localhost/" onChange={(e) => setUrl(e.target.value)} />
          {mode === 'site' && <><input className="input pc-max" type="number" min="2" max="100" value={max} aria-label="Pages to check" title="Pages to check" onChange={(e) => setMax(Number(e.target.value) || 20)} /><InfoTip title="Pages to check">Up to how many pages of the site are checked (start page included).</InfoTip></>}
          <Btn className="primary" icon={Play} busy={busy} type="submit">{mode === 'site' ? 'Check website' : 'Check'}</Btn>
        </form>
        {targets.length > 0 && <div className="row-tight pc-chips"><span className="tiny muted">Your web servers:</span>{targets.slice(0, 10).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => run(x.url)}>{x.label}</button>)}</div>}
        {!fixed && d.recent.length > 0 && <div className="row-tight pc-chips"><span className="tiny muted">Checked before:</span>{d.recent.slice(0, 8).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => run(x.url)}>{x.url.replace(/^https?:\/\//, '').slice(0, 40)} · {x.score}</button>)}</div>}
        {!embedded && <Callout kind="info" dismissible>The check reads the HTML your server sends – like a search engine. Pages that only appear through JavaScript show fewer results here.</Callout>}
      </div></div>
      {busy && !r && !s ? <Loading text={mode === 'site' ? t('Checking the website …') : undefined} /> : s ? <SiteResult s={s} onPick={(u) => { setMode('page'); run(u, 'page'); }} /> : r ? <Result r={r} /> : st.loading ? <Loading /> : <Empty icon={FileSearch} title="No check yet" text="Enter the address of a page of your project or pick one of your web servers above." />}
      {st.data && <Settings config={d.config} url={(r && r.url) || (s && s.url) || ''} onSaved={(c) => st.setData({ ...d, config: c })} />}
    </div>
  );
}

function PageCheckPage() {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><FileSearch /> Page check</h1>
          <p>How fast is the page, what do search engines see, can everyone use it and is it safe? With concrete tips.</p>
        </div>
      </div>
      <PageCheckView />
    </div>
  );
}

/** Tab on every project: its addresses as quick picks. */
function ProjectTab({ p }) {
  const urls = (p.urls || []).filter((u) => /^https?:\/\//.test(u));
  if (!urls.length) return <Empty icon={FileSearch} title="Not checked yet" text="This project has no address yet – start it or add a web server first." />;
  return <PageCheckView embedded start={urls[0]} targets={urls.map((u) => ({ url: u, label: u.replace(/^https?:\/\//, '') }))} />;
}

/** Tab in the web server area: every web server and virtual host. */
function WebTab() { return <PageCheckView embedded />; }

export default {
  pages: { main: PageCheckPage },
  slots: {
    'project.tabs': [{ id: 'seiten-check', title: 'Page check', icon: FileSearch, Component: ProjectTab, order: 72 }],
    'web.tabs': [{ id: 'seiten-check', title: 'Page check', icon: FileSearch, Component: WebTab }],
  },
  // Kein festes Kürzel – wer will, legt eins unter Einstellungen → Allgemein → Tastenkürzel fest
  shortcuts: [{ id: 'open', title: 'Check a page', run: () => { location.hash = '/ext/page-check'; } }],
};
