import { useCallback, useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import "./App.css";

function scoreColor(score) {
  if (score == null) return "#9aa0a6";
  if (score >= 90) return "#34a853";
  if (score >= 50) return "#f9ab00";
  return "#d93025";
}

function ScoreCard({ label, score }) {
  return (
    <div className="score-card">
      <div className="score-ring" style={{ borderColor: scoreColor(score) }}>
        <span style={{ color: scoreColor(score) }}>{score ?? "—"}</span>
      </div>
      <div className="score-label">{label}</div>
    </div>
  );
}

function fmtSeconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function Check({ ok, label, detail }) {
  return (
    <li className={ok ? "pass" : "fail"}>
      <span className="check-icon">{ok ? "✓" : "✗"}</span>
      <span className="check-label">{label}</span>
      {detail && <span className="check-detail">{detail}</span>}
    </li>
  );
}

export default function App() {
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [strategy, setStrategy] = useState("mobile");
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [ov, hist] = await Promise.all([
        fetch("/api/overview").then((r) => r.json()),
        fetch("/api/history").then((r) => r.json()),
      ]);
      setOverview(ov);
      setHistory(hist);
      setError(null);
    } catch {
      setError("API unreachable — is the Node server running on port 3001?");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runCollect = async () => {
    setCollecting(true);
    try {
      await fetch("/api/collect", { method: "POST" });
      await load();
    } finally {
      setCollecting(false);
    }
  };

  const ps = overview?.pagespeed?.[strategy];
  const audit = overview?.audit;
  const chartData = history.map((h) => ({
    time: fmtDate(h.collected_at),
    Mobile: h.mobile_performance,
    Desktop: h.desktop_performance,
  }));

  return (
    <div className="app">
      <header>
        <div>
          <h1>SEO &amp; Performance Dashboard</h1>
          <p className="subtitle">
            Tracking <strong>davehomes.ca</strong>
            {overview?.latestRun && <> · last collected {fmtDate(overview.latestRun.collected_at)} · {overview.runCount} run{overview.runCount === 1 ? "" : "s"}</>}
          </p>
        </div>
        <button onClick={runCollect} disabled={collecting}>
          {collecting ? "Collecting…" : "Run new audit"}
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="strategy-toggle">
        <button className={strategy === "mobile" ? "active" : ""} onClick={() => setStrategy("mobile")}>Mobile</button>
        <button className={strategy === "desktop" ? "active" : ""} onClick={() => setStrategy("desktop")}>Desktop</button>
      </div>

      <section className="cards">
        <ScoreCard label="Performance" score={ps?.performance} />
        <ScoreCard label="SEO" score={ps?.seo} />
        <ScoreCard label="Accessibility" score={ps?.accessibility} />
        <ScoreCard label="Best Practices" score={ps?.best_practices} />
      </section>
      {!ps && (
        <p className="hint">PageSpeed scores appear once the Google PageSpeed API key is connected and a collection runs.</p>
      )}

      <div className="grid">
        <section className="panel">
          <h2>Core Web Vitals ({strategy})</h2>
          <table className="vitals">
            <tbody>
              <tr><td>Largest Contentful Paint</td><td>{fmtSeconds(ps?.lcp_ms)}</td></tr>
              <tr><td>Cumulative Layout Shift</td><td>{ps?.cls ?? "—"}</td></tr>
              <tr><td>Interaction to Next Paint</td><td>{ps?.inp_ms != null ? `${Math.round(ps.inp_ms)}ms` : "—"}</td></tr>
              <tr><td>First Contentful Paint</td><td>{fmtSeconds(ps?.fcp_ms)}</td></tr>
              <tr><td>Time to First Byte</td><td>{ps?.ttfb_ms != null ? `${Math.round(ps.ttfb_ms)}ms` : "—"}</td></tr>
              <tr><td>Total Blocking Time</td><td>{ps?.tbt_ms != null ? `${Math.round(ps.tbt_ms)}ms` : "—"}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>On-page SEO audit</h2>
          {audit ? (
            <ul className="checks">
              <Check ok={audit.status_code === 200} label="HTTP 200" detail={`${Math.round(audit.response_ms)}ms response`} />
              <Check ok={!!audit.has_meta_description} label="Meta description" detail={`${audit.meta_description_len} chars`} />
              <Check ok={!!audit.has_og_image} label="Open Graph image" />
              <Check ok={!!audit.has_canonical} label="Canonical URL" />
              <Check ok={audit.h1_count >= 1} label="H1 headings" detail={`${audit.h1_count} found`} />
              <Check ok={!!audit.sitemap_ok} label="sitemap.xml" />
              <Check ok={!!audit.robots_ok} label="robots.txt" />
              <Check ok label="Page weight" detail={`${(audit.page_bytes / 1_000_000).toFixed(1)} MB`} />
            </ul>
          ) : (
            <p className="hint">No audit data yet — run a collection.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Performance trend</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#9aa0a6" />
              <YAxis domain={[0, 100]} stroke="#9aa0a6" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="Mobile" stroke="#f9ab00" strokeWidth={2} dot />
              <Line type="monotone" dataKey="Desktop" stroke="#34a853" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="hint">Trends appear after the first collection run.</p>
        )}
      </section>

      <footer>
        Data: Google PageSpeed Insights API + live site audit · Collected by Python · Served by Node/Express · Built with React
      </footer>
    </div>
  );
}
