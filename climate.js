// Loads the pre-built climate dataset (data/monthly.json, produced by
// scripts/fetch-data.js and refreshed monthly by a GitHub Action — see
// .github/workflows/update-data.yml) and derives climbing-relevant stats
// from it. The browser never talks to Open-Meteo directly: it fetches this
// one same-origin JSON file, which is fast and doesn't depend on every
// visitor's browser making 22 live cross-origin requests.

const DATA_URL = "data/monthly.json";

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

// Fetches the pre-built dataset. Returns { generatedAt, startYear, endYear,
// areas: { areaId: monthlyRows[] } }.
async function loadAllData() {
  let res;
  try {
    res = await fetch(DATA_URL, { cache: "no-cache" });
  } catch (err) {
    throw new Error(`network error loading ${DATA_URL} (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`${DATA_URL} returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json || typeof json.areas !== "object" || !json.startYear || !json.endYear) {
    throw new Error(`${DATA_URL} is malformed`);
  }
  return json;
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
  loadAllData,
  deriveYearly,
  linearFit,
  trendPerDecade,
  averageOverRange,
  valueToDisplay,
  celsiusDeltaToDisplay,
  unitLabel,
};
