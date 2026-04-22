import { Chart, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import {
  ALLOWED_PERCENTILES,
  measure,
  parseDate,
  percentileCurve,
  type MeasurementResult,
  type MeasurementType,
  type Sex,
  type Standard,
} from "./growth";

Chart.register(...registerables, annotationPlugin);

type Theme = "system" | "light" | "dark";
const THEME_KEY = "growth-app:theme";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

function currentTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function isDarkActive(): boolean {
  const t = currentTheme();
  return t === "dark" || (t === "system" && darkMedia.matches);
}

function updateChartDefaults() {
  const dark = isDarkActive();
  Chart.defaults.color = dark ? "#cfd4da" : "#14171a";
  Chart.defaults.borderColor = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".theme-toggle button")) {
    btn.setAttribute("aria-checked", btn.dataset.themeValue === theme ? "true" : "false");
  }
  updateChartDefaults();
  if (lastResults.length) renderResults(lastResults);
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".theme-toggle button")) {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.themeValue as Theme;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });
}
darkMedia.addEventListener("change", () => {
  if (currentTheme() === "system") applyTheme("system");
});

const form = document.getElementById("calc-form") as HTMLFormElement;
const resultsSection = document.getElementById("results") as HTMLElement;
const template = document.getElementById("result-template") as HTMLTemplateElement;
const summaryTemplate = document.getElementById("summary-template") as HTMLTemplateElement;
const summaryStatTemplate = document.getElementById("summary-stat-template") as HTMLTemplateElement;
const errorMsg = document.getElementById("error-msg") as HTMLElement;
const printBtn = document.getElementById("print-btn") as HTMLButtonElement;

printBtn.addEventListener("click", () => {
  window.print();
});

const STORAGE_KEY = "growth-app:form";
const FIELDS = ["standard", "sex", "birth_date", "measurement_date", "weight", "height"] as const;

const setTodayBtn = document.getElementById("set-today") as HTMLButtonElement;
setTodayBtn.addEventListener("click", () => {
  const input = form.elements.namedItem("measurement_date") as HTMLInputElement;
  input.value = new Date().toISOString().slice(0, 10);
});

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
  for (const name of FIELDS) {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (!el || !saved[name]) continue;
    if (el instanceof HTMLSelectElement) {
      // Only restore if the saved value matches one of the options.
      if (Array.from(el.options).some((o) => o.value === saved[name])) el.value = saved[name];
    } else {
      el.value = saved[name];
    }
  }
} catch {
  // ignore malformed storage
}

// Apply presets declared via data-* attributes on the form (set by landing pages).
// Note: when the page locks the standard, the form renders a hidden input directly
// rather than a select, so there's no UI element to preset here.
const presetStandard = form.dataset.presetStandard;
const standardEl = form.elements.namedItem("standard");
if (presetStandard && standardEl instanceof HTMLSelectElement) {
  standardEl.value = presetStandard;
}
const measurementTypes = form.dataset.measurementTypes;
if (measurementTypes === "weight") {
  const heightInput = form.elements.namedItem("height") as HTMLInputElement | null;
  if (heightInput) {
    heightInput.value = "";
    heightInput.closest("label")?.classList.add("hidden");
  }
} else if (measurementTypes === "height") {
  const weightInput = form.elements.namedItem("weight") as HTMLInputElement | null;
  if (weightInput) {
    weightInput.value = "";
    weightInput.closest("label")?.classList.add("hidden");
  }
}

const BAND_COLORS: Record<number, string> = {
  3: "#3b82f6",
  5: "#f59e0b",
  10: "#10b981",
  25: "#ef4444",
  50: "#7c3aed",
  75: "#92400e",
  90: "#ec4899",
  95: "#6b7280",
  97: "#a3a635",
};

const activeCharts = new Map<HTMLCanvasElement, Chart>();
let lastResults: MeasurementResult[] = [];

applyTheme(currentTheme());
// Auto-calculate on load if the form was restored from localStorage with enough data.
calculate({ throwIfEmpty: false });

function calculate(opts: { throwIfEmpty: boolean }): boolean {
  errorMsg.textContent = "";
  try {
    const fd = new FormData(form);
    const sexRaw = (fd.get("sex") as string) ?? "";
    const birthRaw = (fd.get("birth_date") as string) ?? "";
    const measuredRaw = (fd.get("measurement_date") as string) ?? "";
    const weightRaw = ((fd.get("weight") as string) ?? "").trim();
    const heightRaw = ((fd.get("height") as string) ?? "").trim();

    if (!sexRaw || !birthRaw || !measuredRaw) {
      if (opts.throwIfEmpty) throw new Error("Fill in sex, birth date, and measurement date.");
      return false;
    }
    if (!weightRaw && !heightRaw) {
      if (opts.throwIfEmpty) throw new Error("Enter weight, length/height, or both.");
      return false;
    }

    const toSave: Record<string, string> = {};
    for (const name of FIELDS) toSave[name] = String(fd.get(name) ?? "");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));

    const sex = sexRaw as Sex;
    const standard = (fd.get("standard") as Standard) || "auto";
    const birthDate = parseDate(birthRaw);
    const measurementDate = parseDate(measuredRaw);

    const inputs: { type: MeasurementType; value: number }[] = [];
    if (weightRaw) inputs.push({ type: "weight", value: Number(weightRaw) });
    if (heightRaw) inputs.push({ type: "height", value: Number(heightRaw) });

    const results = inputs.map(({ type, value }) =>
      measure({ sex, birthDate, measurementDate, measurementType: type, value, standard }),
    );
    lastResults = results;
    updatePrintInputs(sex, birthRaw, measuredRaw, standard, results);
    renderResults(results);
    return true;
  } catch (err) {
    errorMsg.textContent = err instanceof Error ? err.message : String(err);
    return false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  calculate({ throwIfEmpty: true });
});

function updatePrintInputs(
  sex: Sex,
  birthDate: string,
  measurementDate: string,
  standard: Standard,
  results: MeasurementResult[],
) {
  const root = document.getElementById("print-inputs")!;
  const standardUsed = results[0]?.standardUsed;
  const standardLabel =
    standard === "auto" && standardUsed ? `Auto (${standardUsed.toUpperCase()})` : standard.toUpperCase();
  (root.querySelector('[data-slot="sex"]') as HTMLElement).textContent = sex === "boy" ? "Boy" : "Girl";
  (root.querySelector('[data-slot="birth_date"]') as HTMLElement).textContent = birthDate;
  (root.querySelector('[data-slot="measurement_date"]') as HTMLElement).textContent = measurementDate;
  (root.querySelector('[data-slot="standard"]') as HTMLElement).textContent = standardLabel;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatAgeYearsMonths(months: number): string {
  const totalMonths = Math.round(months);
  const years = Math.floor(totalMonths / 12);
  const rem = totalMonths % 12;
  if (years === 0) return `${totalMonths} month${totalMonths === 1 ? "" : "s"}`;
  const yStr = `${years} year${years === 1 ? "" : "s"}`;
  if (rem === 0) return yStr;
  return `${yStr}, ${rem} month${rem === 1 ? "" : "s"}`;
}

function appendStat(
  parent: HTMLElement,
  opts: { label: string; number: string; suffix: string; context: string },
) {
  const stat = summaryStatTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  (stat.querySelector('[data-slot="label"]') as HTMLElement).textContent = opts.label;
  (stat.querySelector('[data-slot="percentile"]') as HTMLElement).textContent = opts.number;
  (stat.querySelector('[data-slot="suffix"]') as HTMLElement).textContent = opts.suffix;
  (stat.querySelector('[data-slot="context"]') as HTMLElement).textContent = opts.context;
  parent.appendChild(stat);
}

function renderSummary(results: MeasurementResult[]) {
  const card = summaryTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const stats = card.querySelector('[data-slot="stats"]') as HTMLElement;

  const ageMonths = results[0].ageMonths;
  appendStat(stats, {
    label: "Age",
    number: ageMonths.toFixed(1),
    suffix: "months",
    context: formatAgeYearsMonths(ageMonths),
  });

  for (const r of results) {
    const heading = r.measurementType === "weight" ? "Weight" : "Length / Height";
    const rounded = Math.round(r.percentile);
    appendStat(stats, {
      label: heading,
      number: String(rounded),
      suffix: `${ordinalSuffix(rounded)} percentile`,
      context: `${r.value} ${r.unit} · ${r.standardUsed.toUpperCase()}`,
    });
  }
  resultsSection.appendChild(card);
}

function renderResults(results: MeasurementResult[]) {
  for (const chart of activeCharts.values()) chart.destroy();
  activeCharts.clear();
  resultsSection.replaceChildren();
  resultsSection.classList.toggle("hidden", results.length === 0);
  printBtn.classList.toggle("hidden", results.length === 0);

  if (results.length > 0) renderSummary(results);

  for (const r of results) {
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const title = node.querySelector('[data-slot="title"]') as HTMLElement;
    const summary = node.querySelector('[data-slot="summary"]') as HTMLElement;
    const screenCanvas = node.querySelector('[data-slot="chart"]') as HTMLCanvasElement;
    const printCanvas = node.querySelector('[data-slot="print-chart"]') as HTMLCanvasElement;
    const jsonPre = node.querySelector('[data-slot="json"]') as HTMLElement;

    const heading = r.measurementType === "weight" ? "Weight" : "Length / Height";
    title.textContent = `${heading} (${r.unit})`;
    summary.textContent = `${r.standardUsed.toUpperCase()} · ${r.chartKind} · ${r.percentile.toFixed(1)}th percentile at ${r.ageMonths.toFixed(1)} months (${r.value} ${r.unit})`;
    const { table: _omit, ...publicFields } = r;
    jsonPre.textContent = JSON.stringify(publicFields, null, 2);

    resultsSection.appendChild(node);
    drawCharts(screenCanvas, printCanvas, r);
  }
}

function buildDatasets(r: MeasurementResult, ages: number[]) {
  const datasets = ALLOWED_PERCENTILES.map((p) => {
    const y = percentileCurve(r.table, p, ages);
    const emphasized = p === 3 || p === 50 || p === 97;
    return {
      label: `${p}th`,
      data: ages.map((x, i) => ({ x, y: y[i] })),
      borderColor: BAND_COLORS[p],
      borderWidth: p === 50 ? 2.5 : 1.2,
      borderDash: emphasized ? [] : [4, 3],
      pointRadius: 0,
      tension: 0.2,
    };
  });
  datasets.push({
    label: "Measurement",
    data: [{ x: r.ageMonths, y: r.value }],
    borderColor: "#2d6ae0",
    borderWidth: 2,
    borderDash: [],
    // @ts-expect-error chart.js mixed line/point config
    backgroundColor: "#2d6ae0",
    pointRadius: 7,
    pointHoverRadius: 8,
    showLine: false,
    tension: 0,
  });
  return datasets;
}

function drawCharts(
  screenCanvas: HTMLCanvasElement,
  printCanvas: HTMLCanvasElement,
  r: MeasurementResult,
) {
  const tableMin = r.table[0].month;
  const tableMax = r.table[r.table.length - 1].month;
  const halfWindow = Math.min(12, r.ageMonths - tableMin, tableMax - r.ageMonths);
  const xmin = Math.floor(r.ageMonths - halfWindow);
  const xmax = Math.ceil(r.ageMonths + halfWindow);
  const steps = 400;
  const ages: number[] = [];
  for (let i = 0; i < steps; i++) ages.push(xmin + ((xmax - xmin) * i) / (steps - 1));

  const yLabel = r.measurementType === "weight" ? "Weight (kg)" : "Length / Height (cm)";
  const titleText = `${r.standardUsed.toUpperCase()} ${r.chartKind} (${r.sex})`;

  // Screen chart — responsive, follows theme via Chart.defaults.
  const screen = new Chart(screenCanvas, {
    type: "line",
    data: { datasets: buildDatasets(r, ages) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 14, font: { size: 11 } } },
        title: { display: true, text: titleText },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.parsed as { x: number; y: number };
              return `${ctx.dataset.label}: ${p.y.toFixed(1)} ${r.unit} @ ${p.x.toFixed(1)} mo`;
            },
          },
        },
        annotation: {
          annotations: {
            vline: {
              type: "line", xMin: r.ageMonths, xMax: r.ageMonths,
              borderColor: isDarkActive() ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)",
              borderWidth: 1, borderDash: [4, 4],
            },
            hline: {
              type: "line", yMin: r.value, yMax: r.value,
              borderColor: isDarkActive() ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)",
              borderWidth: 1, borderDash: [4, 4],
            },
            callout: {
              type: "label",
              xValue: r.ageMonths, yValue: r.value,
              xAdjust: 80, yAdjust: -60,
              content: [
                `${r.sex}`,
                `${r.value.toFixed(1)} ${r.unit} @ ${r.ageMonths.toFixed(1)} mo`,
                `~${r.percentile.toFixed(0)}th pct`,
              ],
              font: { size: 11, weight: "bold" },
              color: "#111",
              backgroundColor: "rgba(255,255,255,0.96)",
              borderColor: "#2d6ae0", borderWidth: 1, borderRadius: 6, padding: 8,
              callout: { display: false },
            },
          },
        },
      },
      scales: {
        x: { type: "linear", min: xmin, max: xmax, title: { display: true, text: "Age (months)" } },
        y: { title: { display: true, text: yLabel } },
      },
    },
  });
  activeCharts.set(screenCanvas, screen);

  // Print chart — fixed size, bottom legend, small fonts, light colors baked in.
  const INK = "#14171a";
  const GRID = "rgba(0,0,0,0.1)";
  const print = new Chart(printCanvas, {
    type: "line",
    data: { datasets: buildDatasets(r, ages) },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 9 }, color: INK },
        },
        title: {
          display: true, text: titleText,
          font: { size: 11, weight: "bold" }, color: INK,
        },
        tooltip: { enabled: false },
        annotation: {
          annotations: {
            vline: {
              type: "line", xMin: r.ageMonths, xMax: r.ageMonths,
              borderColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderDash: [4, 4],
            },
            hline: {
              type: "line", yMin: r.value, yMax: r.value,
              borderColor: "rgba(0,0,0,0.25)", borderWidth: 1, borderDash: [4, 4],
            },
            callout: {
              type: "label",
              xValue: r.ageMonths, yValue: r.value,
              xAdjust: 55, yAdjust: -40,
              content: [
                `${r.sex}`,
                `${r.value.toFixed(1)} ${r.unit} @ ${r.ageMonths.toFixed(1)} mo`,
                `~${r.percentile.toFixed(0)}th pct`,
              ],
              font: { size: 9, weight: "bold" },
              color: "#111",
              backgroundColor: "rgba(255,255,255,0.96)",
              borderColor: "#2d6ae0", borderWidth: 1, borderRadius: 5, padding: 5,
              callout: { display: false },
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear", min: xmin, max: xmax,
          title: { display: true, text: "Age (months)", font: { size: 10 }, color: INK },
          ticks: { font: { size: 9 }, color: INK },
          grid: { color: GRID },
        },
        y: {
          title: { display: true, text: yLabel, font: { size: 10 }, color: INK },
          ticks: { font: { size: 9 }, color: INK },
          grid: { color: GRID },
        },
      },
    },
  });
  activeCharts.set(printCanvas, print);
}
