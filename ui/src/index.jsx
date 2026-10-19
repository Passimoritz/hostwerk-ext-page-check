import { useEffect, useState } from 'react';
import { FileSearch, Play, CheckCircle2, XCircle, Gauge, Search, Accessibility, Link2Off, History } from 'lucide-react';
import { get, post, useApi } from '@hostwerk/api';
import { Btn, Empty, Loading, Callout, Sparkline, toast } from '@hostwerk/ui';
import './style.css';

/*
 * Page check: address at the top (or one click on a web server / virtual host), then the score per area, every check
 * with a plain tip, broken links, and the history of that address.
 * Texts are English; German comes from locales/de.json (also inside JSX).
 */
const AREAS = [
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'seo', label: 'Search engines', icon: Search },
  { id: 'a11y', label: 'Accessibility', icon: Accessibility },
];
const tone = (n) => (n >= 90 ? 'ok' : n >= 60 ? 'warn' : 'err');

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

function Result({ r }) {
  const [hist, setHist] = useState([]);
  useEffect(() => { get(`/page-check/history?url=${encodeURIComponent(r.url)}`).then(setHist).catch(() => setHist([])); }, [r.url, r.t]);
  return (
    <div className="stack">
      <div className="card"><div className="card-body pc-head">
        <Ring value={r.score} label="Total" />
        {AREAS.map((a) => <Ring key={a.id} value={r.areas[a.id]} label={a.label} />)}
        <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
          <b className="ellipsis">{r.title || r.url}</b>
          <span className="small muted ellipsis">{r.url}</span>
          <span className="small muted">Status {r.status} · {r.ttfbMs} ms to the first byte · {r.totalMs} ms in total · {Math.round(r.bytes / 1024)} KB</span>
          {hist.length > 1 && <div className="row-tight"><History size={13} className="muted" /><Sparkline data={hist.slice().reverse().map((x) => x.score)} /><span className="tiny muted">Score over the last {hist.length} checks</span></div>}
        </div>
      </div></div>
      <div className="grid grid-3">
        {AREAS.map((a) => (
          <div key={a.id} className="card">
            <div className="card-head"><a.icon size={16} /><h3>{a.label}</h3><span className={`badge ${tone(r.areas[a.id])}`}>{r.areas[a.id]}</span></div>
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
      {r.broken && r.broken.length > 0 && (
        <div className="card">
          <div className="card-head"><Link2Off size={16} /><h3>Broken links and images</h3><span className="badge err">{r.broken.length}</span></div>
          <ul className="pc-broken">{r.broken.map((b) => <li key={b.url}><code className="ellipsis">{b.url}</code><span className="badge err">{b.status || 'no answer'}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function PageCheckPage() {
  const st = useApi('/page-check', [], { live: false });
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const run = async (u = url) => {
    if (!u.trim()) return;
    setUrl(u); setBusy(true);
    try { setR(await post('/page-check/run', { url: u })); st.reload({ silent: true }); } catch (e) { toast.error(e); }
    setBusy(false);
  };
  const d = st.data || { recent: [], targets: [] };
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><FileSearch /> Page check</h1>
          <p>How fast is the page, what do search engines see and can everyone use it? With concrete tips.</p>
        </div>
      </div>
      <div className="card mb"><div className="card-body stack" style={{ gap: 10 }}>
        <form className="row-tight" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <input className="input grow mono" value={url} aria-label="Address of the page" placeholder="http://meinprojekt.localhost/" onChange={(e) => setUrl(e.target.value)} />
          <Btn className="primary" icon={Play} busy={busy} type="submit">Check</Btn>
        </form>
        {d.targets.length > 0 && <div className="row-tight pc-chips"><span className="tiny muted">Your web servers:</span>{d.targets.slice(0, 10).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => run(x.url)}>{x.label}</button>)}</div>}
        {d.recent.length > 0 && <div className="row-tight pc-chips"><span className="tiny muted">Checked before:</span>{d.recent.slice(0, 8).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => run(x.url)}>{x.url.replace(/^https?:\/\//, '').slice(0, 40)} · {x.score}</button>)}</div>}
        <Callout kind="info" dismissible>The check reads the HTML your server sends – like a search engine. Pages that only appear through JavaScript show fewer results here.</Callout>
      </div></div>
      {busy && !r ? <Loading /> : r ? <Result r={r} /> : st.loading ? <Loading /> : <Empty icon={FileSearch} title="No check yet" text="Enter the address of a page of your project or pick one of your web servers above." />}
    </div>
  );
}

export default {
  pages: { main: PageCheckPage },
};
