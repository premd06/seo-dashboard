/**
 * SEO & Performance Analytics Dashboard — REST API.
 *
 * Serves metrics collected by the Python collector (../collector/collect.py)
 * from a SQLite database, and can trigger a fresh collection run.
 *
 * Endpoints:
 *   GET  /api/health    — service status
 *   GET  /api/overview  — latest snapshot (PageSpeed scores + site audit)
 *   GET  /api/history   — every collection run, for trend charts
 *   POST /api/collect   — run the Python collector now
 */

import express from "express";
import cors from "cors";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "dashboard.db");
const COLLECTOR = path.join(ROOT, "collector", "collect.py");
const PYTHON = path.join(ROOT, "collector", "venv", "bin", "python");
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

function openDb() {
  if (!existsSync(DB_PATH)) return null;
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dbExists: existsSync(DB_PATH) });
});

app.get("/api/overview", (_req, res) => {
  const db = openDb();
  if (!db) return res.json({ empty: true });
  try {
    const latestRun = db
      .prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
      .get();
    if (!latestRun) return res.json({ empty: true });

    const pagespeed = db
      .prepare("SELECT * FROM pagespeed WHERE run_id = ? ORDER BY strategy")
      .all(latestRun.id);
    const audit = db
      .prepare("SELECT * FROM site_audit WHERE run_id = ?")
      .get(latestRun.id);
    const runCount = db.prepare("SELECT COUNT(*) AS n FROM runs").get().n;

    res.json({
      empty: false,
      runCount,
      latestRun,
      pagespeed: Object.fromEntries(pagespeed.map((p) => [p.strategy, p])),
      audit: audit || null,
    });
  } finally {
    db.close();
  }
});

app.get("/api/history", (_req, res) => {
  const db = openDb();
  if (!db) return res.json([]);
  try {
    const rows = db
      .prepare(
        `SELECT r.id AS run_id, r.collected_at,
                MAX(CASE WHEN p.strategy = 'mobile'  THEN p.performance END) AS mobile_performance,
                MAX(CASE WHEN p.strategy = 'desktop' THEN p.performance END) AS desktop_performance,
                MAX(CASE WHEN p.strategy = 'mobile'  THEN p.seo END)         AS mobile_seo,
                MAX(p.lcp_ms) AS lcp_ms,
                a.response_ms AS response_ms
           FROM runs r
           LEFT JOIN pagespeed p ON p.run_id = r.id
           LEFT JOIN site_audit a ON a.run_id = r.id
          GROUP BY r.id
          ORDER BY r.collected_at ASC`
      )
      .all();
    res.json(rows);
  } finally {
    db.close();
  }
});

let collecting = false;
app.post("/api/collect", (_req, res) => {
  if (collecting) {
    return res.status(409).json({ ok: false, error: "Collection already running" });
  }
  collecting = true;
  const child = spawn(PYTHON, [COLLECTOR], { cwd: ROOT });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  child.on("close", (code) => {
    collecting = false;
    if (code === 0) {
      res.json({ ok: true, log: stdout.trim().split("\n").slice(-3) });
    } else {
      res.status(500).json({ ok: false, error: stderr.trim() || "Collector failed" });
    }
  });
  child.on("error", (err) => {
    collecting = false;
    res.status(500).json({ ok: false, error: String(err) });
  });
});

app.listen(PORT, () => {
  console.log(`SEO Dashboard API listening on http://localhost:${PORT}`);
});
