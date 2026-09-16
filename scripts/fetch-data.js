#!/usr/bin/env node
// Fetches 30 years of daily weather for every climbing area from
// Open-Meteo's archive API, reduces it to per-(year, month) sums/counts,
// and writes the result to data/monthly.json. Requires Node 18+ (built-in
// fetch). This is meant to run in CI (see .github/workflows/update-data.yml)
// where outbound internet access is normal and unrestricted — it can also
// be run locally by anyone with a working connection.
"use strict";

const fs = require("fs");
const path = require("path");
const { CLIMBING_AREAS } = require("../areas.js");

const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";
// A 30-year, 4-variable daily request is "expensive" against Open-Meteo's
// weighted per-minute quota — 4 concurrent requests tripped its "Minutely
// API request limit exceeded" error almost immediately in practice. Fetch
// fully serially with pacing between requests instead of trying to be fast;
// this is a monthly CI job, not a page load, so there's no rush.
const CONCURRENCY = 1;
const REQUEST_PACING_MS = 5000; // wait this long between the start of each area's request
const MAX_RETRIES = 4; // CI can afford to be patient; this isn't a live visitor waiting
const RATE_LIMIT_WAIT_MS = 65000; // Open-Meteo's own message says "try again in one minute"

const END_YEAR = new Date().getFullYear() - 1; // last fully-elapsed year
const START_YEAR = END_YEAR - 29; // 30 years total, inclusive

function buildUrl(area) {
  const params = new URLSearchParams({
    latitude: area.lat,
    longitude: area.lon,
    start_date: `${START_YEAR}-01-01`,
    end_date: `${END_YEAR}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum",
    timezone: "UTC",
  });
  return `${ARCHIVE_BASE}?${params.toString()}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reduces raw Open-Meteo daily arrays to one row of running sums/counts per
// (year, month). Kept in sync by hand with the (much smaller) client-side
// deriveYearly() in climate.js, which consumes exactly this shape.
function aggregateMonthly(daily) {
  const byYearMonth = new Map();
  for (let i = 0; i < daily.time.length; i++) {
    const year = Number(daily.time[i].slice(0, 4));
    const month = Number(daily.time[i].slice(5, 7));
    const k = `${year}-${month}`;
    if (!byYearMonth.has(k)) {
      byYearMonth.set(k, {
        year, month,
        highSum: 0, highCount: 0,
        lowSum: 0, lowCount: 0,
        freezeDays: 0, hotDays: 0, primeDays: 0,
        totalPrecip: 0, precipCount: 0,
        totalSnowfall: 0, snowCount: 0,
      });
    }
    const row = byYearMonth.get(k);
    const high = daily.temperature_2m_max[i];
    const low = daily.temperature_2m_min[i];
    const precip = daily.precipitation_sum[i];
    const snow = daily.snowfall_sum[i];

    if (high != null) {
      row.highSum += high;
      row.highCount++;
      if (high > 32) row.hotDays++;
      if (high >= 10 && high <= 24) row.primeDays++;
    }
    if (low != null) {
      row.lowSum += low;
      row.lowCount++;
      if (low < 0) row.freezeDays++;
    }
    if (precip != null) {
      row.totalPrecip += precip;
      row.precipCount++;
    }
    if (snow != null) {
      row.totalSnowfall += snow;
      row.snowCount++;
    }
  }
  return Array.from(byYearMonth.values());
}

async function fetchArea(area) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(buildUrl(area));
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body && body.reason) reason = body.reason;
        } catch (err) {
          // body wasn't JSON — keep the generic HTTP status reason
        }
        const err = new Error(`${area.name}: ${reason}`);
        err.rateLimited = res.status === 429 || /API request limit exceeded/i.test(reason);
        err.retryable = err.rateLimited || res.status >= 500;
        throw err;
      }
      const json = await res.json();
      if (!json.daily || !Array.isArray(json.daily.time) || json.daily.time.length === 0) {
        throw new Error(`${area.name}: empty response`);
      }
      return aggregateMonthly(json.daily);
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === MAX_RETRIES) break;
      const wait = err.rateLimited ? RATE_LIMIT_WAIT_MS : Math.round(800 * 2 ** attempt + Math.random() * 400);
      console.warn(`  retrying ${area.name} in ${wait}ms (attempt ${attempt + 2}/${MAX_RETRIES + 1}): ${err.message}`);
      await delay(wait);
    }
  }
  throw lastErr;
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      if (next < items.length) await delay(REQUEST_PACING_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  console.log(`Fetching ${START_YEAR}-${END_YEAR} daily weather for ${CLIMBING_AREAS.length} areas from Open-Meteo...`);
  const areasOut = {};
  const failures = [];

  await mapWithConcurrency(CLIMBING_AREAS, CONCURRENCY, async (area) => {
    try {
      areasOut[area.id] = await fetchArea(area);
      console.log(`  ok: ${area.name}`);
    } catch (err) {
      failures.push({ area, error: err });
      console.error(`  FAILED: ${area.name}: ${err.message}`);
    }
  });

  if (failures.length > 0) {
    console.error(
      `\n${failures.length}/${CLIMBING_AREAS.length} area(s) failed after ${MAX_RETRIES + 1} attempts each. ` +
      `Not writing data/monthly.json — keeping the last good version in place.`
    );
    process.exitCode = 1;
    return;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    startYear: START_YEAR,
    endYear: END_YEAR,
    areas: areasOut,
  };
  const outPath = path.join(__dirname, "..", "data", "monthly.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
