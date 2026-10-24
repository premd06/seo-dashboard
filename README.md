# seo dashboard for davehomes.ca

I built this to keep an eye on my website (davehomes.ca) — how fast it loads, whether the SEO basics are in place, stuff like that. It was also my first project with a real frontend and backend, which was honestly the main point.

## how it works

python script collects the data → stores it in sqlite → node/express api serves it → react page shows it

- **collector/** — python script. Calls the Google PageSpeed Insights API for scores and Core Web Vitals (mobile + desktop), and also audits the live site itself: status, response time, title/meta tags, sitemap, robots.txt. Everything gets saved with a timestamp so changes show up over time.
- **server/** — the express api. Reads the database, and can kick off a new collection run.
- **client/** — react dashboard (vite + recharts). Score cards, a Core Web Vitals table, an on-page SEO checklist, and a chart of scores over time.

## what you need

A Google PageSpeed API key (free). Without one you get rate-limited pretty quick. The collector reads it from an env var called `PAGESPEED_API_KEY`.

## run it

```bash
# 1. collect some data
cd collector
python3 -m venv venv && ./venv/bin/pip install requests
PAGESPEED_API_KEY=<your-key> ./venv/bin/python collect.py

# 2. start the api
cd ../server
npm install
npm start                 # http://localhost:3001

# 3. start the dashboard
cd ../client
npm install
npm run dev               # http://localhost:5173
```

## api endpoints

- `GET /api/health` — server + database status
- `GET /api/overview` — latest scores and audit
- `GET /api/history` — every run (this feeds the trend chart)
- `POST /api/collect` — run the collector again

## still to do

- Google Search Console data (clicks, impressions, average position) — that one needs OAuth, haven't set it up yet
- run the collector on a schedule so the trend chart fills in on its own
- alert me somehow if the performance score tanks
