# growth-chart-calculator

Client-side growth percentile calculator. Converts `(sex, birth date, measurement date, type, value)` into a WHO or CDC percentile and z-score using the LMS method (Cole & Green, 1992).

Everything runs in the browser — no data leaves the device.

Live: <https://growthchartcalculator.com>

## Tech

- Astro + TypeScript
- Chart.js for the growth chart
- LMS reference tables (WHO 2006, CDC 2000) bundled at build time via Vite's `?raw` loader

## Develop

```bash
npm install
npm run dev       # Vite dev server
npm run build     # tsc + vite build → dist/
npm run preview   # serve the built dist/
```

`npm run build` is the full check — `tsc` is the only type check; there's no separate lint step.

## Structure

- `src/references.ts` — loads the CSV LMS tables from `src/data/` and exposes `getReference(standard, sex, type, age)`.
- `src/growth.ts` — LMS math (Box-Cox / log fallback, normal CDF via Abramowitz & Stegun, inverse via Beasley-Springer-Moro). No deps.
- `src/main.ts` — form wiring + chart rendering.
- `src/pages/` — Astro routes, including the calculator (`index.astro`) and landing pages (`who-growth-chart`, `cdc-growth-chart`, `baby-percentile-calculator`, etc.).

## Reference data

`src/data/` contains the LMS tables:

- WHO (0–60 months): sex-specific files, `month` column.
- CDC (0–240 months): single file per metric with `Sex` (1=boy, 2=girl) and `Agemos`.

`getReference` normalizes both into `{ month, L, M, S }`.

## Deploy

Cloudflare Pages builds on every push to `main`:

- Framework: Astro
- Build command: `npm run build`
- Output: `dist`

## License

MIT
