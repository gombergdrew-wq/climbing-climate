# Crag Climate

Dynamic charts comparing **30 years of historical weather** at 22 major
climbing areas across six continents — Yosemite to Kalymnos, Joshua Tree to
Railay — to see where and how much warming has actually shown up on the rock.

**[Live site](https://gombergdrew-wq.github.io/climbing-climate/)** (once
GitHub Pages is enabled — see below).

## How it works

This is a fully static site — plain HTML/CSS/JS, no build step, no backend,
no pre-baked data files. When you load the page, your browser fetches 30
years of daily temperature/precipitation/snowfall directly from the free
[Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api)
(derived from the ECMWF ERA5 reanalysis) for every area — one batched
request — then computes everything client-side:

- Per-month averages/counts per area (avg high/low, freezing days, "prime
  climbing days," days too hot to send, precipitation, snowfall)
- A linear trend (change per decade) per area and metric, for the whole
  year or for just a chosen month/season
- Baseline decade (first 10 years) vs. recent decade (last 10 years)
  comparisons
- A global ranking of all 22 areas by warming trend for the selected metric

Daily data is reduced to per-(year, month) sums/counts before caching in
`localStorage` — compact, and enough to derive a whole-year view *or* any
month/season view (e.g. "just October," "just Winter") without re-fetching.
Because everything runs in the browser, the charts are genuinely dynamic —
pick any combination of up to 5 areas, any metric, any time of year, °C or
°F — with no server to keep running and nothing to redeploy when the "data"
changes (there isn't any to redeploy; it's always live).

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

No install needed — it's static files:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploying (GitHub Pages)

This repo has no build step, so Pages just needs to be pointed at the
branch. One-time setup:

1. On GitHub: **Settings → Pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)` → **Save**

GitHub will publish the site at `https://<you>.github.io/climbing-climate/`
within a minute or two, and re-publish automatically on every push to `main`.

## Project layout

- `index.html` — page structure
- `styles.css` — theme (light/dark aware), layout, chart chrome
- `areas.js` — the roster of 22 climbing areas (name, coordinates, style)
- `climate.js` — fetching, caching, and aggregating Open-Meteo data into
  yearly stats; has no DOM dependencies
- `app.js` — UI wiring and Chart.js rendering
- `vendor/chart.umd.js` — [Chart.js](https://www.chartjs.org/) (MIT),
  vendored locally instead of loaded from a CDN

## Adding a climbing area

Add an entry to the `CLIMBING_AREAS` array in `areas.js` with an `id`,
`name`, `country`, `continent`, `lat`/`lon`, optional `elevationM`, and a
short `style` tag. No other changes needed — it'll show up in the picker and
the global ranking automatically.
