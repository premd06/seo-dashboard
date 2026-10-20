#!/usr/bin/env python3
"""
SEO & Performance data collector for davehomes.ca.

Pulls real metrics from external APIs and a live site audit, then stores
timestamped snapshots in SQLite so the dashboard can chart trends over time.

Sources:
  - Google PageSpeed Insights API (Lighthouse): performance / SEO /
    accessibility / best-practices scores + Core Web Vitals (LCP, CLS, INP).
  - Live site audit: HTTP status, response time, page weight, and on-page
    SEO signals (title, meta description, OG tags, canonical, sitemap, robots).

Usage:
  python collect.py [--url https://example.com]
  Optional: set PAGESPEED_API_KEY env var for higher API rate limits.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "dashboard.db"
PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
DEFAULT_URL = "https://davehomes.ca"


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at TEXT NOT NULL,
            target_url TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pagespeed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL REFERENCES runs(id),
            strategy TEXT NOT NULL,
            performance INTEGER,
            seo INTEGER,
            accessibility INTEGER,
            best_practices INTEGER,
            lcp_ms REAL,
            cls REAL,
            inp_ms REAL,
            fcp_ms REAL,
            ttfb_ms REAL,
            speed_index_ms REAL,
            tbt_ms REAL
        );
        CREATE TABLE IF NOT EXISTS site_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL REFERENCES runs(id),
            status_code INTEGER,
            response_ms REAL,
            page_bytes INTEGER,
            title TEXT,
            has_meta_description INTEGER,
            meta_description_len INTEGER,
            has_og_image INTEGER,
            has_canonical INTEGER,
            h1_count INTEGER,
            sitemap_ok INTEGER,
            robots_ok INTEGER
        );
        """
    )
    conn.commit()


def fetch_pagespeed(url: str, strategy: str) -> dict:
    """Call the PageSpeed Insights API for one strategy (mobile/desktop)."""
    params = {
        "url": url,
        "strategy": strategy,
        "category": ["performance", "seo", "accessibility", "best-practices"],
    }
    api_key = os.environ.get("PAGESPEED_API_KEY")
    if api_key:
        params["key"] = api_key
    resp = requests.get(PSI_ENDPOINT, params=params, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    lighthouse = data["lighthouseResult"]
    categories = lighthouse["categories"]
    audits = lighthouse["audits"]

    def score(name):
        s = categories[name]["score"]
        return round(s * 100) if s is not None else None

    def audit_ms(audit_id):
        audit = audits.get(audit_id)
        if audit and audit.get("numericValue") is not None:
            return round(audit["numericValue"], 2)
        return None

    cls_audit = audits.get("cumulative-layout-shift", {})
    return {
        "strategy": strategy,
        "performance": score("performance"),
        "seo": score("seo"),
        "accessibility": score("accessibility"),
        "best_practices": score("best-practices"),
        "lcp_ms": audit_ms("largest-contentful-paint"),
        "cls": cls_audit.get("numericValue"),
        "inp_ms": audit_ms("interaction-to-next-paint"),
        "fcp_ms": audit_ms("first-contentful-paint"),
        "ttfb_ms": audit_ms("server-response-time"),
        "speed_index_ms": audit_ms("speed-index"),
        "tbt_ms": audit_ms("total-blocking-time"),
    }


def audit_site(url: str) -> dict:
    """Fetch the live page and check on-page SEO signals."""
    start = time.perf_counter()
    resp = requests.get(
        url,
        timeout=60,
        headers={"User-Agent": "SEO-Dashboard-Audit/1.0"},
    )
    elapsed_ms = (time.perf_counter() - start) * 1000
    html = resp.text

    def has(pattern):
        return 1 if re.search(pattern, html, re.IGNORECASE) else 0

    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    desc_match = re.search(
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
        html,
        re.IGNORECASE | re.DOTALL,
    )

    def check_path(path):
        try:
            r = requests.head(url.rstrip("/") + path, timeout=30, allow_redirects=True)
            return 1 if r.status_code == 200 else 0
        except requests.RequestException:
            return 0

    return {
        "status_code": resp.status_code,
        "response_ms": round(elapsed_ms, 1),
        "page_bytes": len(resp.content),
        "title": title_match.group(1).strip() if title_match else None,
        "has_meta_description": 1 if desc_match else 0,
        "meta_description_len": len(desc_match.group(1)) if desc_match else 0,
        "has_og_image": has(r'property=["\']og:image["\']'),
        "has_canonical": has(r'rel=["\']canonical["\']'),
        "h1_count": len(re.findall(r"<h1[\s>]", html, re.IGNORECASE)),
        "sitemap_ok": check_path("/sitemap.xml"),
        "robots_ok": check_path("/robots.txt"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect SEO/performance data.")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    collected_at = datetime.now(timezone.utc).isoformat()
    cur = conn.execute(
        "INSERT INTO runs (collected_at, target_url) VALUES (?, ?)",
        (collected_at, args.url),
    )
    run_id = cur.lastrowid

    summary = {"run_id": run_id, "collected_at": collected_at, "url": args.url}

    for strategy in ("mobile", "desktop"):
        try:
            result = fetch_pagespeed(args.url, strategy)
        except requests.HTTPError as exc:
            print(f"[pagespeed:{strategy}] API error: {exc}", file=sys.stderr)
            summary[f"pagespeed_{strategy}"] = {"error": str(exc)}
            continue
        conn.execute(
            """INSERT INTO pagespeed
               (run_id, strategy, performance, seo, accessibility, best_practices,
                lcp_ms, cls, inp_ms, fcp_ms, ttfb_ms, speed_index_ms, tbt_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, result["strategy"], result["performance"], result["seo"],
                result["accessibility"], result["best_practices"], result["lcp_ms"],
                result["cls"], result["inp_ms"], result["fcp_ms"], result["ttfb_ms"],
                result["speed_index_ms"], result["tbt_ms"],
            ),
        )
        summary[f"pagespeed_{strategy}"] = result
        print(f"[pagespeed:{strategy}] performance={result['performance']} "
              f"seo={result['seo']} lcp={result['lcp_ms']}ms cls={result['cls']}")

    audit = audit_site(args.url)
    conn.execute(
        """INSERT INTO site_audit
           (run_id, status_code, response_ms, page_bytes, title,
            has_meta_description, meta_description_len, has_og_image,
            has_canonical, h1_count, sitemap_ok, robots_ok)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            run_id, audit["status_code"], audit["response_ms"], audit["page_bytes"],
            audit["title"], audit["has_meta_description"],
            audit["meta_description_len"], audit["has_og_image"],
            audit["has_canonical"], audit["h1_count"], audit["sitemap_ok"],
            audit["robots_ok"],
        ),
    )
    summary["site_audit"] = audit
    print(f"[audit] status={audit['status_code']} response={audit['response_ms']}ms "
          f"size={audit['page_bytes']}B sitemap={audit['sitemap_ok']} robots={audit['robots_ok']}")

    conn.commit()
    conn.close()
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
