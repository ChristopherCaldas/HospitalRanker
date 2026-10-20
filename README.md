# 🏥 HospitalRanker

*The report card hospitals didn't ask for, built from public CMS and CDC data.*

**Live site: [hospital-ranker.vercel.app](https://hospital-ranker.vercel.app)** · [![CI](https://github.com/ChristopherCaldas/HospitalRanker/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristopherCaldas/HospitalRanker/actions/workflows/ci.yml)

HospitalRanker ranks US hospitals on public CMS quality measures and asks whether hospital crowding and Medicare spending go along with better or worse results. It's a data project at heart: ingesting federal healthcare datasets that are messy, slow to download and released on irregular schedules, then modeling them so they can be compared honestly and explained to someone without a healthcare-data background.

## What it shows today

| Category | CMS measure | Better when |
|---|---|---|
| ER wait times | `OP_18b`: median minutes from ED arrival to departure | lower |
| 30-day mortality | `MORT_30_AMI`: risk-standardized heart attack mortality | lower |
| Patient safety | `PSI_90`: AHRQ composite of serious in-hospital complications | lower |
| Patient satisfaction | `H_COMP_1_STAR_RATING`: HCAHPS nurse communication stars | higher |
| Readmissions | `READM_30_HF`: 30-day heart failure readmission rate | lower |

Each release covers about 5,400 hospitals, and roughly 15,000 hospital-measure scores are available for ranking. Each page shows the period its scores cover and which CMS release they come from.

## Architecture

```
GitHub Actions (monthly) ──► ingest job ──► Neon Postgres ◄── Express API ──► React + Tailwind UI
                                 │
                     CMS metastore + CSV downloads
```

- **Ingestion** (`backend/src/ingest/`): checks each CMS dataset's metadata and downloads its CSV only when a release hasn't been stored yet, retrying through CMS's intermittent 503 errors. Each release is written in one transaction and every release is kept, so scores can be compared over time. A full run takes about 15 seconds; a run with nothing new takes about 3.
- **Database**: Postgres on [Neon](https://neon.com). Tables: `cms_releases`, `hospitals`, `measures` (which drives what gets ingested) and `measure_scores`, which keeps confidence intervals, case counts, CMS footnotes and each measure's own reporting window. Migrations are plain SQL in `backend/migrations/`.
- **API** (`backend/`): Express + TypeScript. Ranks from the newest release that actually has scores for a measure, and breaks ties by case count. Serves `/api/rankings/:category` and `/api/health`.
- **Frontend** (`frontend/`): React 18, Vite, Tailwind. Rankings with plain-language explanations, a States view (tile map, scatter plot, correlation table) and a hospital explorer.

### Data notes

- CMS suppressed the hospital-wide readmission measure (`Hybrid_HWR`) for every hospital in its September 2026 release. The ingestion run flags this, and the readmissions category now uses the heart failure readmission rate. `Hybrid_HWR` is still ingested in case it comes back.
- Measure windows differ: mortality covers 3 years, safety 2, and ER times and patient surveys 1. All of them lag the release date.
- CDC's weekly hospital data has a hole: federal reporting requirements lapsed from May to October 2024, and only about 37% of hospitals reported voluntarily. Each week is stored with its reporting coverage and period instead of being silently dropped. That matters because about a quarter of the readmissions measure's window falls in that period, compared with 8% for ER wait times.
- Medicare spending uses CMS's price-standardized payments, which remove regional wage and price differences. That changes the picture: Alaska spends $12,050 per beneficiary in actual dollars but $9,209 standardized. The figures cover Original Medicare only, so states with heavy Medicare Advantage enrollment are flagged. Puerto Rico is 96% Medicare Advantage, which leaves its fee-for-service figures unrepresentative.

## Findings: strain, spending and outcomes

Analysis run 1 covers the CMS releases of August and September 2026 and compares the 50 states and DC. Each outcome is compared with strain and spending averaged over **that measure's own reporting window**. The results below are the associations that survive a 5% false-discovery-rate correction (Benjamini–Hochberg across all 25 tests), after controlling for each state's share of dual-eligible (low-income) beneficiaries.

| Outcome (state average) | Associated with | Partial r | FDR q |
|---|---|---|---|
| Longer ER stays (`OP_18b`) | Higher ICU occupancy | +0.43 | 0.021 |
| Longer ER stays (`OP_18b`) | Higher inpatient occupancy | +0.39 | 0.024 |
| More heart failure readmissions (`READM_30_HF`) | Higher ICU occupancy | +0.38 | 0.024 |
| More heart failure readmissions | Higher inpatient Medicare spending | +0.59 | < 0.001 |
| More heart failure readmissions | Higher total Medicare spending | +0.39 | 0.024 |
| Lower nurse-communication ratings (HCAHPS) | Higher total Medicare spending | −0.41 | 0.023 |

Heart attack mortality and the PSI 90 safety composite showed no association with strain or spending that survives the correction.

**How to read this.** These are associations across 51 states, not causal effects, and states differ in many ways the analysis can't see. Part of the readmissions–inpatient spending link is mechanical, because readmissions *are* inpatient stays. Four other associations looked significant on their own (95% CI excluding zero) but didn't survive the multiple-comparison correction, which is why the correction is applied.

### Method

- **State outcome:** each hospital's score weighted by its case count. PSI 90 publishes no case counts, so it uses a plain average.
- **Strain:** CDC weekly occupancy and COVID + flu admissions per 100 beds, averaged over the measure window. Weeks are skipped when fewer than half of a state's hospitals reported or occupancy is above 100%, which removes most of the voluntary-reporting period in 2024.
- **Spending:** Medicare price-standardized spend per Original Medicare beneficiary, weighted by how much of each year falls inside the window. The spending file ends in 2024, so windows that run into 2025 rely on 2024 figures. State spending is very stable year to year (r ≥ 0.987 every year since 2018), which makes that a safe assumption.
- **Statistics:** Pearson r with Fisher-z confidence intervals, Spearman ρ, partial r, and Benjamini–Hochberg q-values, all computed in SQL and checked against an independent implementation. Results are stored as snapshots whenever an input changes, because CDC revises past weeks.

## Expected vs. actual: ranking hospitals with their context in mind

A raw ranking rewards hospitals with easy circumstances. The **Expected vs. actual** page compares each hospital with what it would be expected to score given things it doesn't control.

**Fair context, not excuses.** For each measure, a weighted regression predicts scores from:
- **peer group:** hospital type (critical access, VA, etc.) and ownership;
- **patients:** the hospital's own share of dual-eligible (Medicare + Medicaid) stays and its low-income (DSH) patient percentage, from CMS's IPPS impact and HRRP files;
- **community:** its county's CDC Social Vulnerability Index, poverty and uninsured rates, and whether it's rural;
- **complexity:** case mix index and residents per bed. These are used **only for ER times and patient ratings**, which CMS doesn't risk-adjust. For mortality, readmissions and PSI 90, CMS already adjusts for patient risk, so case mix and teaching there would mostly measure what big academic centers are good at;
- **state conditions:** bed occupancy, price-standardized Medicare spending and low-income share over the score's own period.

Deliberately left out:
- **Hospital size**, so larger hospitals keep credit for the quality that comes with volume.
- **Finances and staffing**, which are partly management's choices: adjusting for them would grade an understaffed hospital on a curve. Finances get their own page instead (below).

**Does context matter?** Measured on hospitals the model didn't see (5-fold cross-validated R²), before and after adding the hospital- and county-level context:

| Measure | State context only | Fair context | Biggest factor | Rank correlation, raw vs. adjusted |
|---|---|---|---|---|
| ER wait times | 37% | **49%** | How complex its care is | 0.64 |
| Patient satisfaction | 22% | **37%** | The hospital's patients (income) | 0.79 |
| Readmissions | 3% | **8%** | Medicare spending, community | 0.90 |
| 30-day mortality | 3% | **7%** | Its community | 0.92 |
| Patient safety (PSI 90) | 0% | 2% | n/a | 0.92 |

Before choosing these, I tested how much *any* state-level factor could add by fitting a separate term for every state: at most 3–6 points. Differences between hospitals in the same state are far larger than differences between states, so state tax revenue, income or similar figures can't fix a weak model. Hospital-level data can.

**Then, who beats expectations?**
- **Difference from expected** = actual minus expected, oriented so positive is better.
- **Uncertainty is handled per measure:**
  - Raw measures (ER minutes, star ratings) are pulled toward their expected score in proportion to their noise (empirical Bayes). Star ratings also get a fixed rounding-noise floor.
  - CMS's published mortality, readmission and PSI 90 scores are already smoothed by CMS, so they aren't smoothed twice; their posterior uncertainty is used instead. PSI 90's published interval is wider than the actual spread between hospitals, a sign that it's already smoothed.
- **Clear cases only:** a hospital is labeled better or worse than expected only when its whole 95% interval is beyond one standard deviation of real hospital-to-hospital variation.
- **Overall ranking:** hospitals with 3 or more measures get a composite score:
  - the average difference from expected, in those standard-deviation units;
  - **each measure capped at ±3**, so one extreme score can't decide the overall rank on its own (PSI 90 has a long bad tail);
  - shrunk again, so noisy hospitals can't top the list on luck.

  In the current run, 7 hospitals are clearly better than expected overall and 19 clearly worse, out of 3,049.
- **Known limitation:** specialty hospitals (e.g. orthopedic, eye and ear) have high case mix and teaching scores but narrow emergency departments, so their expected ER times can be generous.

The model's math (weighted least squares with standard errors, cross-validation, noise estimation, shrinkage, handling of missing context) is unit-tested on synthetic hospitals with planted effects and outliers.

### Up close, and a sanity check against other ratings

**Trends.** CMS keeps a zip snapshot of every hospital file for each data refresh since 2019. `npm run ingest:archive` loads the last snapshot of each year as extra releases. That gives every hospital a yearly trend for each measure, drawn against the national median for the same period. The median matters because some shifts hit every hospital at once: heart failure readmissions jumped nationally in the 2025 period (median 19.6% → 21.3%).

**The top and bottom 5** each get a card. It shows:
- which measures put the hospital there (actual vs. expected);
- its trends since 2018;
- short, linked summaries of news coverage, curated by hand in `backend/src/content/hospitalNotes.ts`.

The trends also explain the hospitals flagged on patient safety:
- **St Bernards (Jonesboro, AR):** PSI 90 safety score went 0.88 → 0.96 → 1.01 → 1.21 → 1.61 → 3.16 over six periods, the highest in the country.
- **Beebe (Lewes, DE):** 0.81 → 3.07. **Mississippi Baptist:** 0.87 → 2.43.
- The national PSI 90 distribution didn't move over the same years (median 0.96, 99th percentile ~1.65), so these are hospital-specific changes, not a change in how CMS scores safety.

**Does the ranking agree with anyone else?**
- **U.S. News Honor Roll 2026–27:**
  - All 20 Honor Roll hospitals rank in our top third, up from 13 with state-only context.
  - The typical one ranks #214 of 3,049, up from #767.
  - 3 of our top 5 are on it: NYU Langone, NewYork-Presbyterian and Mayo Arizona. Mayo Rochester is #6.
- **CMS overall star rating:** rank correlation 0.40 across 2,920 hospitals. The typical 5★ hospital ranks #685 here and the typical 1★ hospital #2,423. Agreement fell slightly from 0.47, as expected: CMS stars don't adjust for patients' income, and this ranking now does.

## Follow the money: finances as diagnostics

The **Finances** page and every hospital page show figures from each hospital's latest Medicare cost report (CMS Hospital Provider Cost Report, 5,188 hospitals). Each figure is shown against national and same-type medians:
- margin on patient care, and overall margin after other income (donations, grants, government appropriations, investments);
- uncompensated care;
- Medicaid share of patient days;
- contract staff, staff per bed and occupancy.

What they show:
- **Most hospitals lose money on patients and make it up elsewhere.** 55% lose money on patient care, but only 29% lose money overall. Government-run hospitals rely most on other income (median 13% of patient revenue).
- **Money barely tracks beating expectations.** Margins have a rank correlation of only 0.06 with the context-adjusted score.
- **Staffing tracks it more.** Hospitals that spend more on contract (agency) staff (−0.20) or run fuller (−0.17) tend to fall short of expectations. These are associations, not causes: a struggling hospital may hire agency staff *because* it's struggling.

## Roadmap (in progress)

- [x] **Release-aware ingestion.** A scheduled job checks CMS dataset metadata and only re-ingests when a new release is published, so users never wait on CMS. Every release is kept, which enables trends and "biggest movers".
- [x] **Statistical rigor in rankings.** A minimum case volume (default 25), tie-breaking by case count, and CMS's own confidence intervals and "better / worse than national" verdicts wherever CMS publishes them. In current releases that's only PSI 90.
- [x] **Hospital strain ingestion.** Weekly CDC NHSN state hospital respiratory data (occupancy, ICU, COVID/flu/RSV admissions) from August 2020 on, loaded weekly with reporting coverage.
- [x] **Strain vs. outcomes.** Strain averaged over each CMS measure's own reporting window, with coverage-filtered weeks (see Findings).
- [x] **Spending ingestion.** Medicare spending per beneficiary by state for 2014–2024, in actual and price-standardized dollars, plus Medicare Advantage share and dual-eligible share.
- [x] **Spend vs. outcomes.** Price-standardized spending compared against outcomes over each measure's window (see Findings).
- [x] **Show the analysis in the app.** A States view with an equal-area tile map, a strain or spending scatter plot with its fit line, a plain-language finding, and the full correlation table.
- [x] **Hospital explorer.** Search, plus a page per hospital showing every measure with its percentile within its state and nationally, and the state and national medians.
- [x] **Expected vs. actual.** Context-adjusted rankings with a "does context matter?" check, a leaderboard of over- and under-performers, and expected scores on every hospital page.
- [x] **Trends, spotlight and outside comparison.** Yearly history from CMS archive snapshots back to 2019, top and bottom 5 hospital cards with drivers, trends and sourced news, and a comparison with CMS stars and the U.S. News Honor Roll.
- [x] **Fair context and finances.** Hospital- and county-level context (CMS IPPS impact and HRRP files, CDC Social Vulnerability Index) in the expected-score model, and a Finances page plus per-hospital finances from Medicare cost reports.
- [ ] **Power BI report.** A star-schema `reporting` layer of SQL views feeding a Power BI report kept in the repo as a `.pbip` project.
- [x] **Tests and CI.** Unit, API and SQL integration tests; the SQL tests run every migration on in-process Postgres 18 and check the statistics against an independent implementation. CI runs on every PR.
- [x] **Public deployment** on Vercel. The static frontend is served from the CDN, the Express API runs as a serverless function, and it connects as a read-only database role.

## Running locally

Requires Node 24 and a Postgres database (the project uses Neon).

```bash
npm install
neon env pull                          # or create .env.local with DATABASE_URL and DATABASE_URL_UNPOOLED
npm run migrate --workspace=backend
npm run ingest --workspace=backend     # pulls current CMS releases (~15s)
npm run ingest:strain --workspace=backend  # pulls CDC weekly state strain (~5s)
npm run ingest:spend --workspace=backend   # pulls Medicare spending by state (~3s)
npm run ingest:archive --workspace=backend # yearly CMS snapshots since 2019, for trends (~1.5 min, once)
npm run ingest:context --workspace=backend # hospital context + cost-report finances (~1 min)
npm run analyze --workspace=backend        # snapshots the strain/spend analysis (~2s)
npm run dev                            # backend on :3001, frontend on :5173
npm test                               # unit, API and SQL tests (SQL runs on in-process Postgres)
```

## Deployment

- **Vercel** builds the frontend (`frontend/dist`, served from the CDN) and runs `api/index.ts`, the same Express app as local dev, as a serverless function. `vercel.json` rewrites `/api/*` to it.
- **Read-only database access.** The deployed API connects as `app_readonly`, a role that can only `SELECT`. It's created once with `npm run create-readonly-role --workspace=backend`, which generates the password and writes the connection string to `.env.local`, never to git. That connection string is set as Vercel's `DATABASE_URL`. Its grants are versioned in `backend/migrations/007_app_readonly.sql`.
- **Ingestion and migrations** run from GitHub Actions with the owner role, never from the public site.

## Project history

- **April 2026**: first prototype: React dashboard, Express API, CMS integration and a JSON file cache.
- **May 2026**: about a dozen working sessions trying different AI coding agents on this project, on other machines. That code wasn't carried over, but the comparison shaped how the project is built now.
- **October 2026**: moved the data layer to Postgres on Neon with Claude Code and expanded the scope to strain, spending and Power BI.

## Data sources

- [CMS Provider Data Catalog](https://data.cms.gov/provider-data/), Hospitals: Timely and Effective Care, Complications and Deaths, HCAHPS, Unplanned Hospital Visits, Hospital General Information.
- [CMS Provider Data Catalog archived snapshots](https://data.cms.gov/provider-data/archived-data/hospitals), one per data refresh since 2019 (trends).
- [CMS IPPS final rule impact file and HRRP supplemental file](https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/fy-2027-ipps-final-rule-home-page) (case mix, teaching, low-income and dual-eligible shares).
- [CMS Hospital Provider Cost Report](https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report) (finances).
- [CDC/ATSDR Social Vulnerability Index](https://www.atsdr.cdc.gov/place-health/media/pdfs/2024/10/SVI2022Documentation.pdf), county level.
- [CDC NHSN Weekly Hospital Respiratory Data by Jurisdiction](https://data.cdc.gov/d/ua7e-t2fy).
- [CMS Medicare Geographic Variation, by National, State & County](https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-geographic-comparisons/medicare-geographic-variation-by-national-state-county).

CMS publishes these measures roughly quarterly, and many cover multi-year windows that lag the release date. Rankings describe past performance; they aren't medical advice.
