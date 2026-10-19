# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HospitalRanker is a humorous-but-data-driven dashboard that ranks US hospitals across several outcome categories. It pulls real data from public CMS (Centers for Medicare & Medicaid Services) APIs, caches it locally, and displays top 5 / bottom 5 rankings per category alongside a generated comedic quip.

## Commands

### Development (run both together from root)
```bash
npm install          # installs all workspaces
npm run dev          # starts backend (port 3001) + frontend (port 5173) concurrently
```

### Individual workspaces
```bash
npm run dev --workspace=backend    # Express API only
npm run dev --workspace=frontend   # Vite dev server only
```

### Build
```bash
npm run build        # builds frontend for production (from root)
```

## Architecture

Two-package npm workspace: `frontend/` and `backend/`. No shared package — types are duplicated intentionally to keep the packages independent.

### Backend (`backend/src/`)
- `index.ts` — Express entry point, mounts the routers below and `GET /api/health` (database check)
- `routes/rankings.ts` — `GET /api/rankings/:category?minCases=` — category metadata + quips around `services/rankings.ts`
- `services/rankings.ts` — top/bottom 5 from the newest complete release that has scores for the category's measure (so a release where CMS suppressed it falls back to the previous one); ties break on case count, then name. `minCases` drops low-volume hospitals (ignored for measures without denominators, i.e. PSI_90). Rows carry CI bounds, cases and CMS's compared-to-national verdict — **in current releases only PSI_90 publishes CIs/verdicts**; MORT_30_AMI and READM_30_HF don't.
- `routes/analysis.ts` + `services/analysis.ts` — `GET /api/analysis/:category`: latest snapshot's per-state rows, correlations (with an intercept derived from slope + means for the fit line) and a case-weighted national outcome
- `routes/hospitals.ts` + `services/hospitals.ts` — `GET /api/hospitals?q=&state=&limit=` (name/city search) and `GET /api/hospitals/:id` (every category measure with CI, verdict, footnote, state/national percentile and medians)
- `services/categories.ts` — `CATEGORY_META` (label, descriptions) shared by the routes
- `services/quips.ts` — returns a random funny quip for best/worst hospital per category
- `db/env.ts` — loads `.env.local` / `.env` from the repo root (written by `neon env pull`)
- `db/pool.ts` — shared `pg` Pool on the pooled `DATABASE_URL` (Neon) for request traffic
- `db/migrate.ts` — applies `backend/migrations/*.sql` in order over `DATABASE_URL_UNPOOLED`; `npm run migrate --workspace=backend`
- `ingest/` — release-aware CMS ingestion; `npm run ingest --workspace=backend` (`-- --force` to redo current releases). Reads each dataset's metastore entry, skips CSVs already ingested for every wanted measure, otherwise downloads the CSV and stores it in one transaction. `datasets.ts` maps each dataset's CSV columns; `retry.ts` backs off on CMS 503s and HTML error pages.
- `ingest/strain.ts` — CDC NHSN weekly state respiratory data (`ua7e-t2fy`); `npm run ingest:strain --workspace=backend`. Upserts the full series (CDC revises past weeks); skipped when the dataset's `rowsUpdatedAt` matches the last load in `source_loads`.
- `ingest/spend.ts` — CMS Medicare Geographic Variation PUF, state level, all ages; `npm run ingest:spend --workspace=backend`. Finds the current release in the `data.cms.gov/data.json` catalog (the entry's `identifier` is a stable URL serving the latest release); skipped when that release's `modified` + title is already in `source_loads`.

### Database (Postgres on Neon)
- `cms_releases` — one row per dataset CSV (the download URL is the release identity), with status and the measures ingested
- `hospitals` — latest attributes from Hospital General Information (`xubh-q36u`)
- `measures` — which measures to ingest, their app category, direction and unit. **Drives ingestion.**
- `measure_scores` — hospital × measure × release, with CI bounds, denominator, compared-to-national, footnote and the measure's own start/end dates. Unavailable scores are kept with a NULL score.
- `latest_measure_scores` (view) — scores from each dataset's newest complete release
- `state_weekly_strain` — CDC weekly occupancy / ICU / COVID-flu-RSV admissions per jurisdiction (states, territories, `USA`, HHS regions), with per-metric `pct_*_coverage` (percent of hospitals reporting) and `reporting_period`. **May–Oct 2024 is `voluntary_2024`: ~37% national coverage**, so counts aren't comparable and percentages come from a self-selected subset. ~40 rows report occupancy >100%; kept raw, filter in analysis.
- `state_medicare_spend` — Medicare spend per **Original Medicare (FFS)** beneficiary by state and year (2014+): actual and price-standardized (`*_stdzd_*`) total and inpatient, plus MA participation, dual-eligible share, age, readmission % and ER visits. No risk score in the file, so spend is price- but not risk-adjusted. Exclude or flag PR (96% MA, ~27k FFS benes) and VI in comparisons; standardization matters (AK: $12,050 actual vs $9,209 standardized in 2024).
- `source_loads` — which upstream version of a non-CMS source (CDC, Medicare GV) was loaded, and when

### Analysis (`migrations/006_analysis.sql`, `backend/src/analysis/index.ts`)
- `analysis_*_live` views compute from current data; `npm run analyze --workspace=backend` freezes them into `analysis_state_measure`, `analysis_correlations` and `analysis_hospital_percentiles` under a new `analysis_runs` row, only when the input fingerprint (CMS release per measure + CDC + spend versions) changed. CDC revises past weeks in place, so snapshots keep what was published. Read through `analysis_latest_*` views.
- Scope: 50 states + DC (`analysis_states`). Each measure uses its newest scored release (`analysis_measure_windows`, same rule as the rankings API) and **its own window**.
- State outcome = case-weighted mean of hospital scores (PSI_90 has no denominators → unweighted). Strain = mean over in-window weeks with ≥50% reporting coverage and occupancy ≤100%; respiratory admissions = COVID + flu per 100 beds (RSV voluntary pre-Nov 2024). Spend = standardized $/FFS bene over overlapping years, weighted by overlap days.
- Correlations per measure × factor across states: Pearson r + Fisher-z 95% CI and p, Spearman (average ranks), partial r controlling for dual-eligible share + CI and p, and `partial_q_value` (Benjamini–Hochberg across all tests in the run). **Use `partial_q_value < 0.05` as the significance bar.** Sign is in measure units — check `higher_is_better`.
- Spend data ends 2024, so 1-year windows ending Sep 2025 (OP_18b, HCAHPS) have spend for 25% of the window; justified because state standardized spend correlates ≥0.987 year over year.
- Statistics were cross-checked against an independent JS implementation (r, rho, partial r, BH q all match).

### Scheduled ingestion
Both need the `DATABASE_URL_UNPOOLED` repo secret, run migrate first and `analyze` last.
- `.github/workflows/ingest.yml` — CMS hospital measures + Medicare spend, monthly (1st) + manual dispatch (optionally forced)
- `.github/workflows/ingest-strain.yml` — CDC, weekly (Saturday) + manual dispatch

### Frontend (`frontend/src/`)
- `App.tsx` — header + section nav; routes `#/rankings/:category`, `#/states/:category`, `#/hospitals`, `#/hospitals/:id`
- `lib/router.ts` — tiny hash router (`useHashRoute`, `href`); `lib/format.ts` — `CATEGORIES`, `FACTORS`, value/percentile/date formatting; `lib/colors.ts` — sequential blue ramp and blue↔red diverging scale (red arm matched to blue's OKLab lightness), plus label ink-vs-white choice
- `types.ts` — TypeScript interfaces mirroring the API responses
- `views/RankingsView.tsx` — category tabs, min-cases filter (default 25), `RankingSection`
- `views/StatesView.tsx` — factor picker, finding sentence (FDR q < 0.05 bar), `TileMap` + `Scatter` sharing a highlighted state, correlation table, data table
- `views/HospitalSearchView.tsx` / `views/HospitalDetailView.tsx` — debounced search; per-measure cards with CI, verdict, medians and percentile meters
- `components/TabNav.tsx` — category tab bar (links); `components/RankingSection.tsx` — best/worst layout; `components/RankingTable.tsx` — 5 hospitals with cases, CI and CMS verdict; `components/QuipCard.tsx` — quip banner
- `components/TileMap.tsx` — equal-area state tile grid (every state is one data point); `components/Scatter.tsx` — one-series SVG scatter drawn at measured pixel width, 24px hit targets, fit line, collision-aware labels for the 3 largest residuals
- Charts follow the dataviz skill's specs (thin marks, 2px rings/gaps, one series = no legend box, tooltips on hover + focus, table view). The app is light-mode only.

Vite proxies `/api/*` to `localhost:3001` during development.

## Data Sources

| Category | CMS Dataset ID | Measure ID | Higher is better? |
|---|---|---|---|
| `wait_times` | `yv7e-xc69` (Timely and Effective Care) | `OP_18b` | No |
| `mortality` | `ynj2-r877` (Complications and Deaths) | `MORT_30_AMI` | No |
| `safety` | `ynj2-r877` (Complications and Deaths) | `PSI_90` | No |
| `satisfaction` | `dgck-syfz` (HCAHPS) | `H_COMP_1_STAR_RATING` | Yes |
| `readmission` | `632h-zaca` (Unplanned Hospital Visits) | `READM_30_HF` | No |

`Hybrid_HWR` is still ingested with no category: CMS suppressed it for every hospital in the 2026-09-30 release. CMS releases land roughly quarterly on no fixed day; measure windows span 1–3 years and lag the release.

## Adding a New Category

1. Add a migration inserting the measure into `measures` (with its `category`). If it comes from a new dataset, add a CSV mapping to `MEASURE_DATASETS` in `backend/src/ingest/datasets.ts`
2. Run `npm run migrate` then `npm run ingest` in `backend` — the current release is re-ingested automatically for the new measure
3. Add metadata (label, description) to `CATEGORY_META` in `backend/src/routes/rankings.ts`
4. Add quip arrays to `QUIPS` in `backend/src/services/quips.ts`
5. Add the tab entry to `CATEGORIES` in `frontend/src/App.tsx`
6. Add the type to the `Category` union in `frontend/src/types.ts`
