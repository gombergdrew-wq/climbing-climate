(function () {
  const { METRICS, metricByKey, TIME_OF_YEAR_PRESETS, timeOfYearById,
    loadAllData, deriveYearly, linearFit, trendPerDecade, averageOverRange, valueToDisplay,
    celsiusDeltaToDisplay, unitLabel } = window.ClimateData;

  const PALETTE_VARS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5"];

  // Populated once the dataset loads (see loadData()) — everything that
  // needs them runs only after that succeeds.
  let START_YEAR, END_YEAR, BASELINE_RANGE, RECENT_RANGE, YEARS;

  const state = {
    selectedOrder: DEFAULT_SELECTED_IDS.slice(0, MAX_SELECTED),
    metricKey: "meanHigh",
    timeOfYearId: "year",
    unit: "C",
    monthlyById: new Map(),
    failedIds: new Set(),
    generatedAt: null,
  };

  const els = {};
  ["areaGrid", "metricTabs", "timeOfYearSelect", "unitToggle", "statTiles", "statusBanner",
    "trendChart", "trendTable", "trendTitle", "trendSub",
    "decadeChart", "decadeTable", "decadeTitle", "decadeSub",
    "rankingChart", "rankingTable", "rankingSub",
    "areaCount", "areaCount2", "yearRange", "maxSelected", "dataFreshness"].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  function currentFilter() {
    const t = timeOfYearById(state.timeOfYearId);
    return t.from == null ? null : { from: t.from, to: t.to };
  }

  function yearlyFor(id) {
    const monthly = state.monthlyById.get(id);
    return monthly ? deriveYearly(monthly, currentFilter()) : null;
  }

  function timeOfYearSuffix() {
    const t = timeOfYearById(state.timeOfYearId);
    return t.id === "year" ? "" : ` — ${t.label}`;
  }

  let trendChart, decadeChart, rankingChart;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function colorForIndex(i) {
    return cssVar(PALETTE_VARS[i % PALETTE_VARS.length]);
  }

  function hexToRgb(hex) {
    const m = hex.replace("#", "");
    const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const int = parseInt(full, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  }

  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bch = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r}, ${g}, ${bch})`;
  }

  function divergingColor(score, maxAbs) {
    if (score == null || maxAbs === 0 || !isFinite(maxAbs)) return cssVar("--diverge-mid");
    const t = Math.min(Math.abs(score) / maxAbs, 1);
    const pole = score >= 0 ? cssVar("--diverge-warm") : cssVar("--diverge-cool");
    return lerpColor(cssVar("--diverge-mid"), pole, t);
  }

  function areaById(id) {
    return CLIMBING_AREAS.find((a) => a.id === id);
  }

  function formatValue(value, metric, unit) {
    if (value == null || Number.isNaN(value)) return "—";
    const display = valueToDisplay(value, metric, unit);
    if (metric.kind === "temp") return `${display.toFixed(1)}${unitLabel(metric, unit)}`;
    if (metric.kind === "count") return `${Math.round(display)} ${metric.unitC}`;
    return `${display.toFixed(display >= 100 ? 0 : 1)} ${metric.unitC}`;
  }

  function formatDelta(deltaRaw, metric, unit) {
    if (deltaRaw == null || Number.isNaN(deltaRaw)) return "—";
    const display = metric.kind === "temp" ? celsiusDeltaToDisplay(deltaRaw, unit) : deltaRaw;
    const sign = display >= 0 ? "+" : "";
    const decimals = metric.kind === "temp" ? 1 : (metric.kind === "sum" ? 1 : 0);
    return `${sign}${display.toFixed(decimals)} ${unitLabel(metric, unit)}`;
  }

  function warmingDirection(metric, deltaRaw) {
    if (deltaRaw == null || metric.warmingIsUp === null) return "neutral";
    const consistent = metric.warmingIsUp ? deltaRaw > 0 : deltaRaw < 0;
    if (Math.abs(deltaRaw) < 1e-9) return "neutral";
    return consistent ? "warming" : "cooling";
  }

  // ---------- Static chrome ----------

  function initChrome() {
    els.areaCount.textContent = String(CLIMBING_AREAS.length);
    els.areaCount2.textContent = String(CLIMBING_AREAS.length);
    els.maxSelected.textContent = String(MAX_SELECTED);
  }

  // Called once the dataset has loaded and START_YEAR/END_YEAR are known.
  function renderDataChrome() {
    els.yearRange.textContent = `${START_YEAR}–${END_YEAR}`;
    if (els.dataFreshness && state.generatedAt) {
      const d = new Date(state.generatedAt);
      els.dataFreshness.textContent = `Data updated ${d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`;
    }
  }

  function renderAreaGrid() {
    const byContinent = new Map();
    for (const area of CLIMBING_AREAS) {
      if (!byContinent.has(area.continent)) byContinent.set(area.continent, []);
      byContinent.get(area.continent).push(area);
    }

    els.areaGrid.innerHTML = "";
    for (const [continent, areas] of byContinent) {
      const group = document.createElement("div");
      group.className = "area-group";
      const heading = document.createElement("div");
      heading.className = "meta";
      heading.style.gridColumn = "1 / -1";
      heading.style.margin = "6px 0 -2px";
      heading.textContent = continent;
      els.areaGrid.appendChild(heading);

      for (const area of areas) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "area-chip";
        btn.dataset.id = area.id;
        btn.innerHTML = `<span class="name">${area.name}</span><span class="meta">${area.country} · ${area.style}</span>`;
        btn.addEventListener("click", () => toggleArea(area.id));
        els.areaGrid.appendChild(btn);
      }
    }
    updateAreaChipStates();
  }

  function updateAreaChipStates() {
    const full = state.selectedOrder.length >= MAX_SELECTED;
    els.areaGrid.querySelectorAll(".area-chip").forEach((btn) => {
      const id = btn.dataset.id;
      const idx = state.selectedOrder.indexOf(id);
      const selected = idx !== -1;
      btn.classList.toggle("is-selected", selected);
      btn.disabled = !selected && full;
      btn.style.setProperty("--chip-color", selected ? colorForIndex(idx) : "");
    });
  }

  function toggleArea(id) {
    const idx = state.selectedOrder.indexOf(id);
    if (idx !== -1) {
      if (state.selectedOrder.length === 1) return; // keep at least one selected
      state.selectedOrder.splice(idx, 1);
    } else {
      if (state.selectedOrder.length >= MAX_SELECTED) return;
      state.selectedOrder.push(id);
    }
    updateAreaChipStates();
    renderSelectionDependent();
  }

  function renderMetricTabs() {
    els.metricTabs.innerHTML = "";
    for (const metric of METRICS) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (metric.key === state.metricKey) btn.classList.add("is-active");
      btn.textContent = metric.shortLabel;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        state.metricKey = metric.key;
        els.metricTabs.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        renderAll();
      });
      els.metricTabs.appendChild(btn);
    }
  }

  function renderTimeOfYearSelect() {
    els.timeOfYearSelect.innerHTML = "";
    let currentGroup = null;
    let groupEl = els.timeOfYearSelect;
    for (const preset of TIME_OF_YEAR_PRESETS) {
      if (preset.group !== currentGroup) {
        currentGroup = preset.group;
        if (preset.group) {
          groupEl = document.createElement("optgroup");
          groupEl.label = preset.group;
          els.timeOfYearSelect.appendChild(groupEl);
        } else {
          groupEl = els.timeOfYearSelect;
        }
      }
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.label;
      groupEl.appendChild(opt);
    }
    els.timeOfYearSelect.value = state.timeOfYearId;
    els.timeOfYearSelect.addEventListener("change", () => {
      state.timeOfYearId = els.timeOfYearSelect.value;
      renderAll();
    });
  }

  function initUnitToggle() {
    els.unitToggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.unit = btn.dataset.unit;
        els.unitToggle.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        renderAll();
      });
    });
  }

  // ---------- Status banner ----------

  function setStatus(kind, html) {
    if (!kind) {
      els.statusBanner.hidden = true;
      els.statusBanner.innerHTML = "";
      return;
    }
    els.statusBanner.hidden = false;
    els.statusBanner.classList.toggle("is-error", kind === "error");
    els.statusBanner.innerHTML = html;
  }

  // ---------- Data loading ----------

  async function loadData() {
    setStatus("loading", "Loading 30 years of climbing-area climate data…");
    try {
      const data = await loadAllData();
      START_YEAR = data.startYear;
      END_YEAR = data.endYear;
      BASELINE_RANGE = [START_YEAR, START_YEAR + 9];
      RECENT_RANGE = [END_YEAR - 9, END_YEAR];
      YEARS = [];
      for (let y = START_YEAR; y <= END_YEAR; y++) YEARS.push(y);

      state.monthlyById = new Map(Object.entries(data.areas));
      state.generatedAt = data.generatedAt;
      state.failedIds = new Set(CLIMBING_AREAS.filter((a) => !state.monthlyById.has(a.id)).map((a) => a.id));

      renderDataChrome();
      if (state.failedIds.size > 0) {
        const names = [...state.failedIds].map((id) => areaById(id).name).join(", ");
        setStatus("warning", `Loaded, but the dataset is missing: ${names}. It'll be filled in on the next monthly refresh.`);
      } else {
        setStatus(null);
      }
      renderAll();
    } catch (err) {
      setStatus("error", `Couldn't load the climate dataset (${err.message}). <button type="button" id="retryBtn" style="cursor:pointer">retry</button>.`);
      const retry = document.getElementById("retryBtn");
      if (retry) retry.addEventListener("click", loadData);
    }
  }

  // ---------- Rendering ----------

  function renderAll() {
    renderStatTiles();
    renderTrendChart();
    renderDecadeChart();
    renderRankingChart();
  }

  function renderSelectionDependent() {
    renderStatTiles();
    renderTrendChart();
    renderDecadeChart();
  }

  function renderStatTiles() {
    const metric = metricByKey(state.metricKey);
    els.statTiles.innerHTML = "";
    state.selectedOrder.forEach((id, idx) => {
      const area = areaById(id);
      const yearly = yearlyFor(id);
      const tile = document.createElement("div");
      tile.className = "stat-tile";
      tile.style.setProperty("--chip-color", colorForIndex(idx));

      if (!yearly) {
        tile.innerHTML = `<div class="area-name">${area.name}</div><div class="skeleton">${state.failedIds.has(id) ? "No data available" : "Loading…"}</div>`;
        els.statTiles.appendChild(tile);
        return;
      }

      const baseline = averageOverRange(yearly, metric.key, BASELINE_RANGE);
      const recent = averageOverRange(yearly, metric.key, RECENT_RANGE);
      const delta = baseline != null && recent != null ? recent - baseline : null;
      const dir = warmingDirection(metric, delta);

      tile.innerHTML = `
        <div class="area-name">${area.name}</div>
        <div class="area-sub">${area.country} · ${area.style}</div>
        <div class="delta ${dir === "warming" ? "is-warming" : dir === "cooling" ? "is-cooling" : ""}">${formatDelta(delta, metric, state.unit)}</div>
        <div class="delta-sub">${metric.label}, ${BASELINE_RANGE[0]}–${BASELINE_RANGE[1]} avg ${formatValue(baseline, metric, state.unit)} → ${RECENT_RANGE[0]}–${RECENT_RANGE[1]} avg ${formatValue(recent, metric, state.unit)}</div>
      `;
      els.statTiles.appendChild(tile);
    });
  }

  function renderTrendChart() {
    const metric = metricByKey(state.metricKey);
    els.trendTitle.textContent = `${metric.label} by year${timeOfYearSuffix()}`;
    els.trendSub.textContent = `${START_YEAR}–${END_YEAR}, dashed line = linear trend`;

    const datasets = [];
    state.selectedOrder.forEach((id, idx) => {
      const area = areaById(id);
      const yearly = yearlyFor(id);
      const color = colorForIndex(idx);
      if (!yearly) return;

      const byYear = new Map(yearly.map((row) => [row.year, row[metric.key]]));
      const data = YEARS.map((y) => {
        const v = byYear.has(y) ? byYear.get(y) : null;
        return valueToDisplay(v, metric, state.unit);
      });
      datasets.push({
        label: area.name,
        data,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.2,
        spanGaps: true,
      });

      const fit = linearFit(yearly, metric.key);
      if (fit) {
        const trendData = YEARS.map((y) => valueToDisplay(fit.slope * y + fit.intercept, metric, state.unit));
        datasets.push({
          label: `${area.name} (trend)`,
          data: trendData,
          borderColor: color,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0,
        });
      }
    });

    const cfg = {
      type: "line",
      data: { labels: YEARS.map(String), datasets },
      options: chartBaseOptions({
        yTitle: `${metric.shortLabel} (${unitLabel(metric, state.unit)})`,
        legendFilter: (item) => !item.text.endsWith("(trend)"),
      }),
    };

    if (trendChart) { trendChart.data = cfg.data; trendChart.options = cfg.options; trendChart.update(); }
    else trendChart = new Chart(els.trendChart.getContext("2d"), cfg);

    renderTrendTable(metric);
  }

  function renderTrendTable(metric) {
    const table = els.trendTable;
    const ids = state.selectedOrder.filter((id) => yearlyFor(id));
    const yearlyByAreaId = new Map(ids.map((id) => [id, yearlyFor(id)]));
    let html = "<thead><tr><th>Year</th>" + ids.map((id) => `<th>${areaById(id).name}</th>`).join("") + "</tr></thead><tbody>";
    for (const y of YEARS) {
      html += `<tr><td>${y}</td>` + ids.map((id) => {
        const row = yearlyByAreaId.get(id).find((r) => r.year === y);
        return `<td>${row ? formatValue(row[metric.key], metric, state.unit) : "—"}</td>`;
      }).join("") + "</tr>";
    }
    html += "</tbody>";
    table.innerHTML = `<caption>Yearly values by area</caption>${html}`;
  }

  function renderDecadeChart() {
    const metric = metricByKey(state.metricKey);
    els.decadeTitle.textContent = `${metric.label}${timeOfYearSuffix()}: ${BASELINE_RANGE[0]}–${BASELINE_RANGE[1]} vs. ${RECENT_RANGE[0]}–${RECENT_RANGE[1]}`;
    els.decadeSub.textContent = "First vs. most recent decade of the 30-year window, averaged.";

    const ids = state.selectedOrder.filter((id) => yearlyFor(id));
    const yearlyByAreaId = new Map(ids.map((id) => [id, yearlyFor(id)]));
    const baselineVals = ids.map((id) => valueToDisplay(averageOverRange(yearlyByAreaId.get(id), metric.key, BASELINE_RANGE), metric, state.unit));
    const recentVals = ids.map((id) => valueToDisplay(averageOverRange(yearlyByAreaId.get(id), metric.key, RECENT_RANGE), metric, state.unit));

    const cfg = {
      type: "bar",
      data: {
        labels: ids.map((id) => areaById(id).name),
        datasets: [
          { label: `${BASELINE_RANGE[0]}–${BASELINE_RANGE[1]}`, data: baselineVals, backgroundColor: cssVar("--series-1") },
          { label: `${RECENT_RANGE[0]}–${RECENT_RANGE[1]}`, data: recentVals, backgroundColor: cssVar("--series-2") },
        ],
      },
      options: chartBaseOptions({ yTitle: `${metric.shortLabel} (${unitLabel(metric, state.unit)})` }),
    };

    if (decadeChart) { decadeChart.data = cfg.data; decadeChart.options = cfg.options; decadeChart.update(); }
    else decadeChart = new Chart(els.decadeChart.getContext("2d"), cfg);

    const table = els.decadeTable;
    let html = `<thead><tr><th>Area</th><th>${BASELINE_RANGE[0]}–${BASELINE_RANGE[1]} avg</th><th>${RECENT_RANGE[0]}–${RECENT_RANGE[1]} avg</th><th>Delta</th></tr></thead><tbody>`;
    ids.forEach((id, i) => {
      const delta = recentVals[i] != null && baselineVals[i] != null ? recentVals[i] - baselineVals[i] : null;
      html += `<tr><td>${areaById(id).name}</td><td>${baselineVals[i] != null ? baselineVals[i].toFixed(1) : "—"}</td><td>${recentVals[i] != null ? recentVals[i].toFixed(1) : "—"}</td><td>${delta != null ? (delta >= 0 ? "+" : "") + delta.toFixed(1) : "—"}</td></tr>`;
    });
    html += "</tbody>";
    table.innerHTML = `<caption>Decade averages by area</caption>${html}`;
  }

  function renderRankingChart() {
    const metric = metricByKey(state.metricKey);
    els.rankingSub.innerHTML = `All <span>${CLIMBING_AREAS.length}</span> areas, ranked by change per decade in ${metric.label.toLowerCase()}${timeOfYearSuffix()}.`;

    const rows = CLIMBING_AREAS
      .map((area) => ({ area, trend: state.monthlyById.has(area.id) ? trendPerDecade(yearlyFor(area.id), metric.key) : null }))
      .filter((r) => r.trend != null)
      .map((r) => ({ ...r, score: metric.warmingIsUp === null ? r.trend : (metric.warmingIsUp ? r.trend : -r.trend) }))
      .sort((a, b) => b.score - a.score);

    const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.score)));
    const displayTrends = rows.map((r) => metric.kind === "temp" ? celsiusDeltaToDisplay(r.trend, state.unit) : r.trend);
    const colors = rows.map((r) => metric.warmingIsUp === null ? cssVar("--series-1") : divergingColor(r.score, maxAbs));

    const cfg = {
      type: "bar",
      data: {
        labels: rows.map((r) => r.area.name),
        datasets: [{ label: metric.shortLabel, data: displayTrends, backgroundColor: colors }],
      },
      options: chartBaseOptions({
        indexAxis: "y",
        xTitle: `Change per decade (${unitLabel(metric, state.unit)})`,
        noLegend: true,
      }),
    };

    if (rankingChart) { rankingChart.data = cfg.data; rankingChart.options = cfg.options; rankingChart.update(); }
    else rankingChart = new Chart(els.rankingChart.getContext("2d"), cfg);

    const table = els.rankingTable;
    let html = "<thead><tr><th>Rank</th><th>Area</th><th>Change per decade</th></tr></thead><tbody>";
    rows.forEach((r, i) => {
      html += `<tr><td>${i + 1}</td><td>${r.area.name}</td><td>${displayTrends[i] >= 0 ? "+" : ""}${displayTrends[i].toFixed(metric.kind === "temp" ? 2 : 1)} ${unitLabel(metric, state.unit)}</td></tr>`;
    });
    html += "</tbody>";
    table.innerHTML = `<caption>Trend per decade, all areas</caption>${html}`;
  }

  function chartBaseOptions({ yTitle, xTitle, indexAxis, noLegend, legendFilter } = {}) {
    const muted = cssVar("--text-muted");
    const grid = cssVar("--gridline");
    const ink = cssVar("--text-secondary");
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: indexAxis || "x",
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: noLegend ? { display: false } : {
          position: "top",
          labels: { color: ink, boxWidth: 12, filter: legendFilter || (() => true) },
        },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          title: xTitle ? { display: true, text: xTitle, color: muted } : undefined,
          ticks: { color: muted },
          grid: { color: grid },
        },
        y: {
          title: yTitle ? { display: true, text: yTitle, color: muted } : undefined,
          ticks: { color: muted },
          grid: { color: grid },
        },
      },
    };
  }

  // ---------- Boot ----------

  initChrome();
  renderAreaGrid();
  renderMetricTabs();
  renderTimeOfYearSelect();
  initUnitToggle();
  loadData();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.monthlyById.size > 0) renderAll();
  });
})();
