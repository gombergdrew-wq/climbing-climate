# Crag Climate

Dynamic charts comparing **30 years of historical weather** at 22 major
climbing areas across six continents — Yosemite to Kalymnos, Joshua Tree to
Railay — to see where and how much warming has actually shown up on the rock.

**[Live site](https://gombergdrew-wq.github.io/climbing-climate/)** (once
GitHub Pages is enabled — see below).

## How it works

This is a static site — plain HTML/CSS/JS — backed by a small data pipeline
instead of live API calls from every visitor's browser:

1. **`scripts/fetch-data.js`** (Node) fetches 30 years of daily
   temperature/precipitation/snowfall for all 22 areas from the free
   [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api)
   (ERA5 reanalysis), reduces it to compact per-(year, month) sums/counts,
   and writes **`data/monthly.json`**.
2. **`.github/workflows/update-data.yml`** runs that script on a schedule
   (monthly — climate data doesn't move fast) and on demand, and commits the
   refreshed `data/monthly.json` back to the repo.
3. The site itself just fetches that one same-origin JSON file and does
   everything else — deriving whole-year or month/season stats, linear
   trends, decade comparisons, the global ranking — client-side in
   `climate.js`/`app.js`.

That means visitors' browsers never talk to Open-Meteo directly: no
cross-origin rate limits, no per-visitor reliability risk, and page load is
one small static fetch instead of 22 live API calls. The "database" is just
a JSON file kept fresh by CI — no server to run, nothing to pay for.

- Pick up to 5 areas, any metric, any time of year (whole year, a season,
  or a single month), °C or °F — every chart recomputes instantly from the
  already-loaded dataset.
- A linear trend (change per decade) per area and metric.
- Baseline decade (first 10 years) vs. recent decade (last 10 years)
  comparisons.
- A global ranking of all 22 areas by warming trend for the selected metric.

Season presets (Winter/Spring/Summer/Fall) use fixed Northern-Hemisphere
calendar months for every area, rather than flipping per hemisphere, so a
comparison always means "the same months" — e.g. "Winter" is Dec–Feb at
both Yosemite and Rocklands, South Africa, even though that's summer for
one of them locally.

## Metrics

All metrics are computed over whichever time-of-year window is selected
(whole year, a season, or a single month):

| Metric | Definition |
|---|---|
| Avg daily high / low / temperature | Mean of ERA5 daily max/min 2m temperature |
| Freezing days | Days with a low below 0°C |
| Prime climbing days | Days with a high between 10–24°C (a common "good sending weather" heuristic) |
| Hot days | Days with a high above 32°C |
| Precipitation | Sum of daily precipitation (mm) |
| Snowfall | Sum of daily snowfall (cm) |

These are simple, transparent heuristics meant to make a 30-year trend
legible at a glance — not a substitute for local route or season knowledge,
and not a peer-reviewed climate product.

## Running locally

The site itself needs no install — it's static files — but it does need
`data/monthly.json` to exist (it's committed to the repo, so a normal clone
already has it):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To refresh the data yourself (Node 18+, needs internet access):

```bash
node scripts/fetch-data.js
```

## Deploying (GitHub Pages)

This repo has no build step for the site itself, so Pages just needs to be
pointed at the branch. One-time setup:

1. On GitHub: **Settings → Pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)` → **Save**

GitHub will publish the site at `https://<you>.github.io/climbing-climate/`
within a minute or two, and re-publish automatically on every push to
`main` — including the automated data-refresh commits.

## Project layout

- `index.html` — page structure
- `styles.css` — theme (light/dark aware), layout, chart chrome
- `areas.js` — the roster of 22 climbing areas (name, coordinates, style);
  also `require()`-able from Node for the fetch script
- `climate.js` — loads `data/monthly.json` and derives yearly/seasonal
  stats, trends, and decade comparisons; has no DOM dependencies
- `app.js` — UI wiring and Chart.js rendering
- `data/monthly.json` — the pre-built dataset (generated, not hand-edited)
- `scripts/fetch-data.js` — the Node script that builds `data/monthly.json`
  from Open-Meteo
- `.github/workflows/update-data.yml` — runs that script monthly and on
  demand, committing the result
- `vendor/chart.umd.js` — [Chart.js](https://www.chartjs.org/) (MIT),
  vendored locally instead of loaded from a CDN

## Adding a climbing area

Add an entry to the `CLIMBING_AREAS` array in `areas.js` with an `id`,
`name`, `country`, `continent`, `lat`/`lon`, optional `elevationM`, and a
short `style` tag, then run `node scripts/fetch-data.js` (or push — the
workflow re-runs automatically when `areas.js` changes) to pull its data.
It'll then show up in the picker and the global ranking automatically.
