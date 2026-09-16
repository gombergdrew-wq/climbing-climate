// Fetches, caches, and aggregates historical daily weather into
// climbing-relevant stats. Everything here runs in the visitor's browser —
// there is no build-time data and no backend; Open-Meteo's archive API
// (ERA5 reanalysis, free, no key, CORS-enabled) is queried directly, one
// area at a time. Raw daily data is reduced to per-month sums/counts before
// caching (small, and enough to derive a whole-year OR a month/season view
// without re-fetching).

const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";
const CACHE_PREFIX = "crag-climate:v2:";
const FETCH_CONCURRENCY = 4; // keep well under Open-Meteo's free-tier burst limit
const MAX_RETRIES = 2;

const THIS_YEAR = new Date().getFullYear();
const END_YEAR = THIS_YEAR - 1; // last fully-elapsed year
const START_YEAR = END_YEAR - 29; // 30 years total, inclusive
const BASELINE_RANGE = [START_YEAR, START_YEAR + 9]; // first decade
const RECENT_RANGE = [END_YEAR - 9, END_YEAR]; // most recent decade

const METRICS = [
  { key: "meanHigh", label: "Avg daily high", shortLabel: "Avg high", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "meanLow", label: "Avg daily low", shortLabel: "Avg low", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "annualMean", label: "Avg temperature", shortLabel: "Avg temp", unitC: "°C", kind: "temp", warmingIsUp: true },
  { key: "freezeDays", label: "Freezing days (low < 0°C)", shortLabel: "Freeze days", unitC: "days", kind: "count", warmingIsUp: false },
  { key: "hotDays", label: "Days too hot to send (high > 32°C)", shortLabel: "Hot days", unitC: "days", kind: "count", warmingIsUp: true },
  { key: "primeDays", label: "Prime climbing days (high 10–24°C)", shortLabel: "Prime days", unitC: "days", kind: "count", warmingIsUp: false },
  { key: "totalPrecip", label: "Precipitation", shortLabel: "Precip", unitC: "mm", kind: "sum", warmingIsUp: null },
  { key: "totalSnowfall", label: "Snowfall", shortLabel: "Snowfall", unitC: "cm", kind: "sum", warmingIsUp: false },
];

// Calendar-month presets. Seasons use fixed Northern-Hemisphere-convention
// months for every area (rather than flipping per hemisphere) so a
// side-by-side comparison always means "the same months," e.g. comparing
// Yosemite and Rocklands in "Winter" both means Dec–Feb at each.
const TIME_OF_YEAR_PRESETS = [
  { id: "year", label: "Whole year", group: null, from: null, to: null },
  { id: "winter", label: "Winter (Dec–Feb)", group: "Season", from: 12, to: 2 },
  { id: "spring", label: "Spring (Mar–May)", group: "Season", from: 3, to: 5 },
  { id: "summer", label: "Summer (Jun–Aug)", group: "Season", from: 6, to: 8 },
  { id: "fall", label: "Fall (Sep–Nov)", group: "Season", from: 9, to: 11 },
  ...["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    .map((label, i) => ({ id: `m${i + 1}`, label, group: "Month", from: i + 1, to: i + 1 })),
];

function timeOfYearById(id) {
  return TIME_OF_YEAR_PRESETS.find((t) => t.id === id) || TIME_OF_YEAR_PRESETS[0];
}

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

function cacheKey(areaId) {
  return `${CACHE_PREFIX}${areaId}:${START_YEAR}-${END_YEAR}`;
}

function readCache(areaId) {
  try {
    const raw = localStorage.getItem(cacheKey(areaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.monthly)) return null;
    return parsed.monthly;
  } catch (err) {
    return null;
  }
}

function writeCache(areaId, monthly) {
  try {
    localStorage.setItem(cacheKey(areaId), JSON.stringify({ monthly }));
  } catch (err) {
    // Storage full or unavailable (private browsing) — non-fatal, just skip caching.
  }
}

// Turns the raw Open-Meteo `daily` arrays into one row of running
// sums/counts per (year, month) — compact, and enough to derive any
// whole-year or month/season view later without re-fetching.
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOneRaw(area) {
  let res;
  try {
    res = await fetch(buildUrl(area));
  } catch (err) {
    const netErr = new Error(`${area.name}: network error (${err.message})`);
    netErr.retryable = true;
    throw netErr;
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.reason) reason = errJson.reason;
    } catch (err) {
      // body wasn't JSON — keep the generic HTTP status reason
    }
    const httpErr = new Error(`${area.name}: ${reason}`);
    httpErr.retryable = res.status === 429 || res.status >= 500;
    throw httpErr;
  }
  const json = await res.json();
  if (!json.daily || !Array.isArray(json.daily.time) || json.daily.time.length === 0) {
    const emptyErr = new Error(`${area.name}: no data returned`);
    emptyErr.retryable = false;
    throw emptyErr;
  }
  return json.daily;
}

async function fetchOneMonthly(area) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const daily = await fetchOneRaw(area);
      const monthly = aggregateMonthly(daily);
      writeCache(area.id, monthly);
      return monthly;
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === MAX_RETRIES) break;
      await delay(500 * 2 ** attempt + Math.random() * 300);
    }
  }
  throw lastErr;
}

// Runs `fn` over `items` with at most `limit` in flight at once (Open-Meteo's
// free tier rate-limits bursts, so fetching all 22 areas at once as one big
// Promise.all was tripping that limit for a lot of them).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Fetches monthly stats for whichever of `areas` aren't already cached
// (throttled + retried), and returns a Map of areaId -> monthly rows for
// every area that succeeded. Areas that fail are simply left out — the
// caller treats a missing id as "couldn't load this one."
async function ensureMonthlyData(areas) {
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

  const settled = await mapWithConcurrency(needed, FETCH_CONCURRENCY, (area) => fetchOneMonthly(area));
  let firstError = null;
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      results.set(needed[i].id, outcome.value);
    } else if (!firstError) {
      firstError = outcome.reason;
    }
  });

  if (results.size === 0 && firstError) {
    throw firstError;
  }
  return results;
}

function monthInRange(month, from, to) {
  return from <= to ? month >= from && month <= to : month >= from || month <= to;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function expectedDaysForFilter(filter) {
  if (!filter) return 365;
  let total = 0;
  let m = filter.from;
  while (true) {
    total += DAYS_IN_MONTH[m - 1];
    if (m === filter.to) break;
    m = (m % 12) + 1;
  }
  return total;
}

// Combines cached per-(year,month) rows into one row per year, honoring an
// optional {from, to} month filter (1-12, `from > to` meaning "wraps across
// the new year," e.g. Dec-Feb). A wrapping range labels the season by the
// year its *last* month falls in — "Winter 2021" = Dec 2020 + Jan/Feb 2021 —
// which is standard meteorological convention.
function deriveYearly(monthly, filter) {
  const wrap = !!filter && filter.from > filter.to;
  const byYear = new Map();
  for (const row of monthly) {
    if (filter && !monthInRange(row.month, filter.from, filter.to)) continue;
    const bucketYear = wrap && row.month >= filter.from ? row.year + 1 : row.year;
    if (!byYear.has(bucketYear)) {
      byYear.set(bucketYear, {
        year: bucketYear,
        highSum: 0, highCount: 0,
        lowSum: 0, lowCount: 0,
        freezeDays: 0, hotDays: 0, primeDays: 0,
        totalPrecip: 0, precipCount: 0,
        totalSnowfall: 0, snowCount: 0,
      });
    }
    const acc = byYear.get(bucketYear);
    acc.highSum += row.highSum; acc.highCount += row.highCount;
    acc.lowSum += row.lowSum; acc.lowCount += row.lowCount;
    acc.freezeDays += row.freezeDays; acc.hotDays += row.hotDays; acc.primeDays += row.primeDays;
    acc.totalPrecip += row.totalPrecip; acc.precipCount += row.precipCount;
    acc.totalSnowfall += row.totalSnowfall; acc.snowCount += row.snowCount;
  }

  const expected = expectedDaysForFilter(filter);
  return Array.from(byYear.values())
    .filter((row) => row.highCount > expected * 0.8 || row.lowCount > expected * 0.8)
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
  TIME_OF_YEAR_PRESETS,
  timeOfYearById,
  START_YEAR,
  END_YEAR,
  BASELINE_RANGE,
  RECENT_RANGE,
  ensureMonthlyData,
  deriveYearly,
  linearFit,
  trendPerDecade,
  averageOverRange,
  valueToDisplay,
  celsiusDeltaToDisplay,
  unitLabel,
};
