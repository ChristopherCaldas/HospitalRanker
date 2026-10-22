# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HospitalRanker is a data dashboard (a portfolio piece shown to recruiters) that ranks US hospitals on CMS outcome measures and compares state results with CDC hospital strain and Medicare spending. Copy is plain-language and professional with a light touch — the header tagline is the only cheeky line; the old quips and emoji were removed deliberately.

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
- `routes/rankings.ts` — `GET /api/rankings/:category?minCases=` — category metadata around `services/rankings.ts` (which also returns the national median and scored-hospital count for context)
- `services/rankings.ts` — top/bottom 5 from the newest complete release that has scores for the category's measure (so a release where CMS suppressed it falls back to the previous one); ties break on case count, then name. `minCases` drops low-volume hospitals (ignored for measures without denominators, i.e. PSI_90). Rows carry CI bounds, cases and CMS's compared-to-national verdict — **in current releases only PSI_90 publishes CIs/verdicts**; MORT_30_AMI and READM_30_HF don't.
- `routes/analysis.ts` + `services/analysis.ts` — `GET /api/analysis/:category`: latest snapshot's per-state rows, correlations (with an intercept derived from slope + means for the fit line) and a case-weighted national outcome
- `routes/hospitals.ts` + `services/hospitals.ts` — `GET /api/hospitals?q=&state=&limit=` (name/city search) and `GET /api/hospitals/:id` (every category measure with CI, verdict, footnote, state/national percentile and medians)
- `services/categories.ts` — `CATEGORY_META` (label, descriptions) shared by the routes
- `db/env.ts` — loads `.env.local` / `.env` from the repo root (written by `neon env pull`)
- `db/pool.ts` — shared `pg` Pool on the pooled `DATABASE_URL` (Neon) for request traffic
- `db/migrate.ts` — applies `backend/migrations/*.sql` in order over `DATABASE_URL_UNPOOLED`; `npm run migrate --workspace=backend`
- `ingest/` — release-aware CMS ingestion; `npm run ingest --workspace=backend` (`-- --force` to redo current releases). Reads each dataset's metastore entry, skips CSVs already ingested for every wanted measure, otherwise downloads the CSV and stores it in one transaction. `datasets.ts` maps each dataset's CSV columns; `retry.ts` backs off on CMS 503s and HTML error pages.
- `ingest/strain.ts` — CDC NHSN weekly state respiratory data (`ua7e-t2fy`); `npm run ingest:strain --workspace=backend`. Upserts the full series (CDC revises past weeks); skipped when the dataset's `rowsUpdatedAt` matches the last load in `source_loads`.
- `ingest/archive.ts` — score history from CMS archive zips (`api/1/archive/aggregate/theme/hospitals/relative`); `npm run ingest:archive --workspace=backend`. Takes the last snapshot of each finished year since 2019, stores each CSV in it as a `cms_releases` row with `source = 'archive'` (download_url = `zip#inner path`), only for snapshots older than the dataset's live release (so "latest release" logic is untouched), and only for hospitals already in `hospitals`. File names changed over the years (2020 zips name files by dataset ID); `PSI_90_SAFETY` is aliased to `PSI_90`. `ingest/store.ts` holds the score insert shared with the live ingester.
- `ingest/context.ts` — hospital-level context + finances; `npm run ingest:context --workspace=backend` (`-- --force`). Reads the newest IPPS final-rule home page (`fy-YYYY-ipps-final-rule-home-page`, tries next FY first) for the impact-file and HRRP-supplemental zips (file names vary by year, so links are scraped); the newest two Hospital Provider Cost Report CSVs from the data.cms.gov catalog (keeps each hospital's latest report); CDC SVI county CSV (tries 2026/2024/2022). Skipped when that version combo is already in `source_loads` (`hospital_context`). Hospitals without an IPPS FIPS code (critical access, Maryland, non-acute) get SVI by county *name* (`countyKey`); CAHs are marked rural.
- `ingest/context.ts` also loads health-system membership from `backend/data/ahrq-hospital-linkage-<AHRQ_YEAR>.csv` (AHRQ Compendium, trimmed to ccn/system id/name). ahrq.gov answers scripted requests with an empty 202 bot check, so the file is checked in; replace it and `AHRQ_YEAR` when a new edition comes out.
- `ingest/changes.ts` — every yearly cost report since 2017 into `hospital_finance_history` (`file_year` ≈ fiscal year begun) and CMS Hospital Change of Ownership into `hospital_ownership_changes`; `npm run ingest:changes --workspace=backend` (`-- --force`). Skipped when the file set is already in `source_loads` (`hospital_changes`). Reuses `costReportFiles`/`costRow`/`get` from `context.ts`.
- `ingest/access.ts` — primary/urgent-care access around each hospital into `hospital_access` (migration 013); `npm run ingest:access --workspace=backend` (`-- --force`). County: County Health Rankings (PCPs, other primary care providers, preventable stays) and Medicare GV county ER/office visits. Within 10 miles of the hospital's ZIP (ZCTA) centroid: ACS population, income (5 mi), NPPES urgent care orgs (taxonomy `261QU0200X`, listed ZIP3 by ZIP3 through the NPPES API, ~12.8k sites; ownership unknown), HRSA health center sites, other hospitals' EDs. **Exploratory only**: not in `analyze`, the fingerprint, the scheduled workflow or the UI.
- `ingest/spend.ts` — CMS Medicare Geographic Variation PUF, state level, all ages; `npm run ingest:spend --workspace=backend`. Finds the current release in the `data.cms.gov/data.json` catalog (the entry's `identifier` is a stable URL serving the latest release); skipped when that release's `modified` + title is already in `source_loads`.

### Database (Postgres on Neon)
- `cms_releases` — one row per dataset CSV (the download URL is the release identity), with status and the measures ingested
- `hospitals` — latest attributes from Hospital General Information (`xubh-q36u`)
- `measures` — which measures to ingest, their app category, direction and unit. **Drives ingestion.**
- `measure_scores` — hospital × measure × release, with CI bounds, denominator, compared-to-national, footnote and the measure's own start/end dates. Unavailable scores are kept with a NULL score.
- `latest_measure_scores` (view) — scores from each dataset's newest complete release
- `state_weekly_strain` — CDC weekly occupancy / ICU / COVID-flu-RSV admissions per jurisdiction (states, territories, `USA`, HHS regions), with per-metric `pct_*_coverage` (percent of hospitals reporting) and `reporting_period`. **May–Oct 2024 is `voluntary_2024`: ~37% national coverage**, so counts aren't comparable and percentages come from a self-selected subset. ~40 rows report occupancy >100%; kept raw, filter in analysis.
- `state_medicare_spend` — Medicare spend per **Original Medicare (FFS)** beneficiary by state and year (2014+): actual and price-standardized (`*_stdzd_*`) total and inpatient, plus MA participation, dual-eligible share, age, readmission % and ER visits. No risk score in the file, so spend is price- but not risk-adjusted. Exclude or flag PR (96% MA, ~27k FFS benes) and VI in comparisons; standardization matters (AK: $12,050 actual vs $9,209 standardized in 2024).
- `measure_score_history` (view, migration 009) — one score per hospital × measure × measurement period (newest release wins, NULL scores skipped); `services/history.ts` adds the national median per period (cached 1h in memory). Heart-failure readmissions shift up nationally in the 2025 period, so read trends against the median.
- `hospital_context` (migration 010) — one row per hospital: county FIPS, rural, DSH %, case mix (newest `TACMIVnn` column), residents per bed, dual proportion (HRRP), county SVI percentile / poverty150 / uninsured. Patient/complexity fields exist only for IPPS acute hospitals (~3,000).
- `hospital_finance` + `hospital_finance_ratios` (view) — latest cost report per hospital (raw $ and days) and derived margins/shares. No days-cash-on-hand: the PUF cash line excludes investments. Cost-report figures follow Medicare accounting, not audited statements; `services/finances.ts` clips ratios to plausible bounds (`FINANCE_METRICS`).
- `source_loads` — which upstream version of a non-CMS source (CDC, Medicare GV) was loaded, and when

### Analysis (`migrations/006_analysis.sql`, `backend/src/analysis/index.ts`)
- `analysis_*_live` views compute from current data; `npm run analyze --workspace=backend` freezes them into `analysis_state_measure`, `analysis_correlations` and `analysis_hospital_percentiles` under a new `analysis_runs` row, only when the input fingerprint (CMS release per measure + CDC + spend versions) changed. CDC revises past weeks in place, so snapshots keep what was published. Read through `analysis_latest_*` views.
- Scope: 50 states + DC (`analysis_states`). Each measure uses its newest scored release (`analysis_measure_windows`, same rule as the rankings API) and **its own window**.
- State outcome = case-weighted mean of hospital scores (PSI_90 has no denominators → unweighted). Strain = mean over in-window weeks with ≥50% reporting coverage and occupancy ≤100%; respiratory admissions = COVID + flu per 100 beds (RSV voluntary pre-Nov 2024). Spend = standardized $/FFS bene over overlapping years, weighted by overlap days.
- Correlations per measure × factor across states: Pearson r + Fisher-z 95% CI and p, Spearman (average ranks), partial r controlling for dual-eligible share + CI and p, and `partial_q_value` (Benjamini–Hochberg across all tests in the run). **Use `partial_q_value < 0.05` as the significance bar.** Sign is in measure units — check `higher_is_better`.
- Spend data ends 2024, so 1-year windows ending Sep 2025 (OP_18b, HCAHPS) have spend for 25% of the window; justified because state standardized spend correlates ≥0.987 year over year.
- Statistics were cross-checked against an independent JS implementation (r, rho, partial r, BH q all match).

### Expected vs. actual (`migrations/008_expected_performance.sql`, `backend/src/analysis/expected.ts`, `stats.ts`)
- Runs inside `npm run analyze` after the SQL snapshots, same transaction. The input fingerprint includes `METHOD_VERSION` in `analysis/index.ts`; **bump it when changing the model** so the next run recomputes.
- Per measure: WLS of score on **fair context** (user decision: things outside management's control): peer group (type/ownership dummies), patients (hospital dual proportion, DSH %), community (county SVI, poverty, uninsured, rural), complexity (case mix, residents/bed: **only for OP_18b and HCAHPS**; for CMS risk-adjusted MORT/READM/PSI they'd erase academic centers' earned advantage, see `activeColumns`), and state occupancy/spend/low-income. Context vars are in readable units (`CONTEXT_VARS.per`), clipped at 1st/99th pct, missing → mean + `no_hospital_data` / `no_county_data` flags. **Not predictors: volume** (keep the volume–quality effect; it only sets noise) **and finances/staffing** (diagnostics only, shown on the Finances page and hospital pages). Hospitals outside the 50 states + DC have no state context and are skipped.
- Uncertainty per `METHODS`: `shrunk` (OP_18b, HCAHPS; noise k/n from `noiseModel`, + 1/12 rounding floor for stars), `cms_smoothed` (MORT/READM/PSI_90: published scores are already posterior means → no second shrink, posterior SD sqrt(τ²se²/(τ²+se²)), τ = spread of gaps; se from binomial, or from CMS's CI for PSI_90 via `SE_FROM_INTERVAL`, whose CI variance exceeds the observed spread).
- Verdicts are "clear cases only" (user decision): the 95% interval must clear a margin of τ (1 SD of real spread). Composite: gaps in τ units **capped at ±`COMPOSITE_CAP` (3)**, averaged over ≥3 measures, shrunk again, margin = composite τ. Known limitation: specialty hospitals (orthopedic, eye & ear) get generous expected ER times from high case mix/teaching.
- Input fingerprint includes the `hospital_context` load version; `METHOD_VERSION` is `expected-v2`.
- "Does context matter?" per measure: `r2_cv` (5-fold), `importance` (CV R² lost dropping each group), coefficients with SEs, `rank_agreement` (raw vs adjusted Spearman).
- Finances: `GET /api/finances` (`services/finances.ts`, cached 1h: summary, by ownership, each finance metric's fifths vs. composite score + Spearman). Hospital detail also returns `finance` (values + national + same-type medians) and `context`. UI: `views/FinancesView.tsx` (`#/finances`), labels in `lib/finance.ts`, cards on `HospitalDetailView`.
- Spotlight + sanity check: `GET /api/performance/spotlight` (national top/bottom 5 with `breakdown` per measure, `history`, curated `notes`), `GET /api/performance/benchmarks` (composite vs CMS stars: crosstab + Spearman; U.S. News Honor Roll ranks + each one's weakest measure). Curated content lives in `backend/src/content/hospitalNotes.ts` (summaries in our own words, linked, press releases labelled; `NOTES_CHECKED` date). Hospital detail also returns `history`, `notes`, `usNewsHonorRoll`.
- Predictors (`migrations/011_predictors.sql`, `backend/src/analysis/predictors.ts`, runs in `analyze` after the expected model; fingerprint key `predictors` = `PREDICTORS_VERSION` in `analysis/index.ts`, bump it when changing this analysis): per measure, CV R² of 11 predictor groups (`GROUPS`) alone and `added` (dropped from `everything_known`; for `track_record`, what it adds on top), four combined `MODELS`, each variable's oriented r. Predicts **actual** scores, any fact allowed (money, staffing, earlier score from a non-overlapping period). Also `analysis_persistence` (current period vs each earlier one, `overlapping` flag) and `analysis_measure_correlations`. API `GET /api/predictors` (`services/predictors.ts`); UI `views/PredictorsView.tsx` (`#/predictors`, `PredictorsReport` renders from data and is tested with SSR), labels in `lib/predictors.ts`. Page sentences are data-driven; keep it that way. `hospital_finance` gained discharges and balance-sheet lines; `hospital_finance_ratios` appends cost_per_discharge, debt_ratio, current_ratio, investments_per_bed, fixed_assets_per_bed, salary_per_fte.
- Movers (`migrations/012_movers.sql`, `backend/src/analysis/movers.ts`, runs in `analyze` after predictors; `MOVERS_VERSION` in the fingerprint, plus the `hospital_changes` load): per measure, current period vs the latest non-overlapping one ≥2.5 years earlier (`pickPeriods`). Change = end − what regression to the mean predicts (start shrunk by its reliability, then a fitted line); raw measures' noise k/n is fitted on residuals after type + log(cases) so size effects aren't mistaken for noise (`samplingVariance`). Clear cases only (95% beyond tau). `changePredictors` regresses the **unshrunk** change on cost-report facts at start, their change, and ownership change (effect in tau units, peer-controlled). Normal-prior shrinkage is conservative for rare big jumps (small hospitals' real jumps often stay "steady"). API `GET /api/movers` (`services/movers.ts`, includes each listed mover's history); hospital detail adds `movers` per category. UI `views/MoversView.tsx` (`#/movers/:category`; fifths are shown relative to the average change so national shifts drop out).
- Exploration (not in `analyze`): `npm run explore:access --workspace=backend [-- out.json]` (`analysis/explore/access.ts`) — CV R² gain from the access variables over fair context / everything, urban vs rural, urgent care × low income interaction, mediation of community coefficients, and an L1 pass (`lasso`/`lassoCv` in `stats.ts`: weighted coordinate descent, 1-SE lambda, stability over 50 half-samples) over every dimension. Reuses `inputQuery`/`weightedScores`/`standardize` from `predictors.ts`.
- API: `GET /api/performance/context`, `GET /api/performance?state=&limit=`, `GET /api/performance/:category`; hospital detail includes `performance`. UI: `views/PerformanceView.tsx` (`#/performance/:category`), labels in `lib/performance.ts`.

### Deployment (Vercel)
- `vercel.json` builds the frontend and rewrites `/api/*` to `api/index.ts`, which re-exports `backend/src/app.ts` (the Express app; `index.ts` only adds `listen` for local dev). `db/pool.ts` calls `attachDatabasePool` when `VERCEL` is set.
- Production `DATABASE_URL` is the **read-only `app_readonly` role** (pooled). Create/rotate it with `npm run create-readonly-role --workspace=backend` (writes `APP_READONLY_DATABASE_URL` to `.env.local`; password never printed or committed). Grants: `migrations/007_app_readonly.sql` (no-op if the role doesn't exist). It's created in SQL because Neon CLI/console roles join `neon_superuser`.
- Tests: `npm test` (backend vitest 5 incl. PGlite SQL tests; frontend vitest 3), `npm run typecheck` (includes `backend/test` via `backend/tsconfig.test.json`). CI: `.github/workflows/ci.yml`.

### Scheduled ingestion
Both need the `DATABASE_URL_UNPOOLED` repo secret, run migrate first and `analyze` last.
- `.github/workflows/ingest.yml` — CMS hospital measures + yearly archive snapshots + hospital context/finances + Medicare spend, monthly (1st) + manual dispatch (optionally forced)
- `.github/workflows/ingest-strain.yml` — CDC, weekly (Saturday) + manual dispatch

### Frontend (`frontend/src/`)
- `App.tsx` — header + section nav; routes `#/rankings/:category`, `#/performance/:category`, `#/predictors`, `#/states/:category`, `#/finances`, `#/hospitals`, `#/hospitals/:id`
- `lib/router.ts` — tiny hash router (`useHashRoute`, `href`); `lib/format.ts` — `CATEGORIES`, `FACTORS`, value/percentile/date formatting; `lib/colors.ts` — sequential blue ramp and blue↔red diverging scale (red arm matched to blue's OKLab lightness), plus label ink-vs-white choice
- `types.ts` — TypeScript interfaces mirroring the API responses
- `views/RankingsView.tsx` — category tabs, min-cases filter (default 25), `RankingSection`
- `views/StatesView.tsx` — factor picker, finding sentence (FDR q < 0.05 bar), `TileMap` + `Scatter` sharing a highlighted state, correlation table, data table
- `views/HospitalSearchView.tsx` / `views/HospitalDetailView.tsx` — debounced search; per-measure cards with CI, verdict, medians and percentile meters
- `components/TabNav.tsx` — category tab bar (links); `components/RankingSection.tsx` — score explanation, "How to read" panel, typical-hospital context line, best/worst layout; `components/RankingTable.tsx` — 5 hospitals with cases, CI and CMS verdict; `components/HowToRead.tsx` — collapsible glossary
- `components/TrendChart.tsx` — small-multiple trend (hospital vs national median, measured width, per-unit minimum y-span, stars fixed 1–5, hover/arrow-key tooltip) + `TrendLegend`
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
3. Add metadata (label, description) to `CATEGORY_META` in `backend/src/services/categories.ts`
4. Add the tab entry to `CATEGORIES` and a plain-language entry to `MEASURE_GUIDE` in `frontend/src/lib/format.ts`
5. Add the type to the `Category` union in `frontend/src/types.ts`
6. Re-run `npm run analyze` so the new measure gets state comparisons
