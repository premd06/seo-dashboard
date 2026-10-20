# SEO & Performance Analytics Dashboard

A full-stack dashboard that tracks the traffic-readiness, SEO health, and
performance of a live production website — [davehomes.ca](https://davehomes.ca).

## Architecture

```
Python collector ──► SQLite ──► Node/Express REST API ──► React dashboard
(collect.py)        (data/)     (server/)                 (client/)
```

- **collector/** — Python 3 script that pulls metrics from external APIs and
  a live site audit, then stores timestamped snapshots in SQLite so trends
  build over time.
- **server/** — Node.js + Express REST API that reads the database and can
  trigger a fresh collection run.
- **client/** — React (Vite) dashboard with score cards, Core Web Vitals,
  an on-page SEO checklist, and trend charts (Recharts).

## Data sources

- **Google PageSpeed Insights API** — Lighthouse performance / SEO /
  accessibility / best-practices scores and Core Web Vitals (LCP, CLS, INP,
  FCP, TTFB, TBT) for mobile and desktop. Requires a free API key
  (`PAGESPEED_API_KEY` env var; free tier allows 25,000 queries/day).
- **Live site audit** — HTTP status, response time, page weight, and on-page
  SEO signals: title, meta description, Open Graph image, canonical URL,
  H1 count, sitemap.xml and robots.txt presence.

## Run it

```bash
# 1. Collect data (Python)
cd collector
python3 -m venv venv && ./venv/bin/pip install requests
PAGESPEED_API_KEY=<your-key> ./venv/bin/python collect.py

# 2. Start the API (Node)
cd ../server
npm install
npm start                 # http://localhost:3001

# 3. Start the dashboard (React)
cd ../client
npm install
npm run dev               # http://localhost:5173
```

## API endpoints

| Method | Endpoint       | Description                                  |
| ------ | -------------- | -------------------------------------------- |
| GET    | /api/health    | Service + database status                    |
| GET    | /api/overview  | Latest snapshot (scores + audit)             |
| GET    | /api/history   | All runs, for trend charts                   |
| POST   | /api/collect   | Trigger the Python collector                 |

## Roadmap

- Google Search Console API integration (clicks, impressions, CTR, average
  position, top queries) via OAuth.
- Scheduled automatic collections (cron) for hands-off trend tracking.
- Score-drop alerts when performance regresses.
