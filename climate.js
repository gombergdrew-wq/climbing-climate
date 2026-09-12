// Fetches, caches, and aggregates historical daily weather into yearly
// climbing-relevant stats. Everything here runs in the visitor's browser —
// there is no build-time data and no backend; Open-Meteo's archive API
// (ERA5 reanalysis, free, no key, CORS-enabled) is queried directly.

const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";
const CACHE_PREFIX = "crag-climate:v1:";

const THIS_YEAR = new Date().getFullYear();
const END_YEAR = THIS_YEAR - 1; // last fully-elapsed year
const START_YEAR = END_YEAR - 29; // 30 years total, inclusive
const BASELINE_RANGE = [START_YEAR, START_YEAR + 9]; // first decade
const RECENT_RANGE = [END_YEAR - 9, END_YEAR]; // most recent decade

const METRICS = [
  { key: "meanHigh", label: "Avg daily high", shortLabel: "Avg high", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "meanLow", label: "Avg daily low", shortLabel: "Avg low", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "annualMean", label: "Avg annual temperature", shortLabel: "Avg temp", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "freezeDays", label: "Freezing days / year (low < 0°C)", shortLabel: "Freeze days", unitC: "days", kind: "count", warmingIsUp: false },
  { key: "hotDays", label: "Days too hot to send (high > 32°C)", shortLabel: "Hot days", unitC: "days", kind: "count", warmingIsUp: true },
  { key: "primeDays", label: "Prime climbing days / year (high 10–24°C)", shortLabel: "Prime days", unitC: "days", kind: "count", warmingIsUp: false },
  { key: "totalPrecip", label: "Annual precipitation", shortLabel: "Precip", unitC: "mm", kind: "sum", warmingIsUp: null },
  { key: "totalSnowfall", label: "Annual snowfall", shortLabel: "Snowfall", unitC: "cm", kind: "sum", warmingIsUp: false },
];

function metricByKey(key) {
  return METRICS.find((m) => m.key === key);
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}

function celsiusDeltaToDisplay(deltaC, unit) {
  return unit === "F" ? deltaC * (9 / 5) : deltaC;
}

function valueToDisplay(value, metric, unit) {
  if (value == null || Number.isNaN(value)) return null;
  if (metric.kind === "temp" && unit === "F") return cToF(value);
  return value;
}

function unitLabel(metric, unit) {
  if (metric.kind === "temp") return unit === "F" ? "°F" : "°C";
  return metric.unitC;
}

// Open-Meteo accepts comma-separated lat/lon lists and batches them into one
// request, returning an array of results in the same order — this lets the
// whole roster load in a single round trip instead of one call per area.
function buildBatchUrl(areas) {
  const params = new URLSearchParams({
    latitude: areas.map((a) => a.lat).join(","),
    longitude: areas.map((a) => a.lon).join(","),
    start_date: `${START_YEAR}-01-01`,
    end_date: `${END_YEAR}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum",
    timezone: "UTC",
  });
  return `${ARCHIVE_BASE}?${params.toString()}`;
}

function cacheKey(areaId) {
  return `${CACHE_PREFIX}${areaId}:${START_YEAR}-${END_YEAR}`;
}

function readCache(areaId) {
  try {
    const raw = localStorage.getItem(cacheKey(areaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.yearly)) return null;
    return parsed.yearly;
  } catch (err) {
    return null;
  }
}

function writeCache(areaId, yearly) {
  try {
    localStorage.setItem(cacheKey(areaId), JSON.stringify({ yearly }));
  } catch (err) {
    // Storage full or unavailable (private browsing) — non-fatal, just skip caching.
  }
}

// Turns the raw Open-Meteo `daily` arrays into one row of stats per year.
function aggregateYearly(daily) {
  const byYear = new Map();
  for (let i = 0; i < daily.time.length; i++) {
    const year = Number(daily.time[i].slice(0, 4));
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        highSum: 0, highCount: 0,
        lowSum: 0, lowCount: 0,
        freezeDays: 0, hotDays: 0, primeDays: 0,
        totalPrecip: 0, precipCount: 0,
        totalSnowfall: 0, snowCount: 0,
      });
    }
    const row = byYear.get(year);
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

  return Array.from(byYear.values())
    .filter((row) => row.highCount > 300 || row.lowCount > 300) // drop partial years
    .sort((a, b) => a.year - b.year)
    .map((row) => ({
      year: row.year,
      meanHigh: row.highCount ? row.highSum / row.highCount : null,
      meanLow: row.lowCount ? row.lowSum / row.lowCount : null,
      annualMean: row.highCount && row.lowCount ? (row.highSum / row.highCount + row.lowSum / row.lowCount) / 2 : null,
      freezeDays: row.freezeDays,
      hotDays: row.hotDays,
      primeDays: row.primeDays,
      totalPrecip: row.precipCount ? row.totalPrecip : null,
      totalSnowfall: row.snowCount ? row.totalSnowfall : null,
    }));
}

// Fetches yearly stats for whichever of `areas` aren't already cached
// (in one batched request), and returns a Map of areaId -> yearly rows for
// every area passed in, cached or not.
async function ensureYearlyData(areas) {
  const results = new Map();
  const needed = [];
  for (const area of areas) {
    const cached = readCache(area.id);
    if (cached) {
      results.set(area.id, cached);
    } else {
      needed.push(area);
    }
  }
  if (needed.length === 0) return results;

  const res = await fetch(buildBatchUrl(needed));
  if (!res.ok) {
    throw new Error(`Open-Meteo returned ${res.status}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json) ? json : [json];
  if (rows.length !== needed.length) {
    throw new Error("Open-Meteo returned an unexpected number of results");
  }

  let anySucceeded = false;
  needed.forEach((area, i) => {
    const daily = rows[i] && rows[i].daily;
    if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
      return; // leave this area out of `results`; caller treats it as failed
    }
    const yearly = aggregateYearly(daily);
    writeCache(area.id, yearly);
    results.set(area.id, yearly);
    anySucceeded = true;
  });

  if (!anySucceeded && needed.length > 0) {
    throw new Error("Open-Meteo returned no usable data");
  }
  return results;
}

// Ordinary least squares fit of value-per-year. Returns null when there
// aren't at least two data points to fit a line through.
function linearFit(yearly, key) {
  const points = yearly
    .map((row) => [row.year, row[key]])
    .filter(([, v]) => v != null && !Number.isNaN(v));
  const n = points.length;
  if (n < 2) return null;

  const meanX = points.reduce((s, [x]) => s + x, 0) / n;
  const meanY = points.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of points) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

// Ordinary least squares slope of value-per-year, returned as change per decade.
function trendPerDecade(yearly, key) {
  const fit = linearFit(yearly, key);
  return fit ? fit.slope * 10 : null;
}

function averageOverRange(yearly, key, [fromYear, toYear]) {
  const values = yearly
    .filter((row) => row.year >= fromYear && row.year <= toYear)
    .map((row) => row[key])
    .filter((v) => v != null && !Number.isNaN(v));
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

window.ClimateData = {
  METRICS,
  metricByKey,
  START_YEAR,
  END_YEAR,
  BASELINE_RANGE,
  RECENT_RANGE,
  ensureYearlyData,
  linearFit,
  trendPerDecade,
  averageOverRange,
  valueToDisplay,
  celsiusDeltaToDisplay,
  unitLabel,
};
