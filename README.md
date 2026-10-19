# 🏥 HospitalRanker

*Serious data. Questionable commentary.*

HospitalRanker ranks US hospitals on public CMS quality measures, showing the best and worst five in each category along with a quip about each. Underneath the jokes, it's a data project: ingesting federal healthcare datasets that are messy, slow to download and released on irregular schedules, then modeling them so they can be compared honestly.

## What it shows today

| Category | CMS measure | Better when |
|---|---|---|
| ER wait times | `OP_18b`: median minutes from ED arrival to departure | lower |
| 30-day mortality | `MORT_30_AMI`: risk-standardized heart attack mortality | lower |
| Patient safety | `PSI_90`: AHRQ composite of serious in-hospital complications | lower |
| Patient satisfaction | `H_COMP_1_STAR_RATING`: HCAHPS nurse communication stars | higher |
| Readmissions | `Hybrid_HWR`: hospital-wide 30-day unplanned readmission rate | lower |

That's about 4,200 hospitals and around 16,000 hospital-measure records after cleaning.

## Architecture

```
CMS Provider Data Catalog API ──► Express API (TypeScript) ──► React + Tailwind UI
                                       │
                                       ▼
                               Neon Postgres (pg)
```

- **`frontend/`**: React 18, Vite, Tailwind. Category tabs, best/worst tables, quip cards.
- **`backend/`**: Express + TypeScript. Fetches CMS data, caches it in Postgres, sorts each measure in the right direction, and serves `/api/rankings/:category` and `/api/health`.
- **Database**: Postgres on [Neon](https://neon.com). The app uses the pooled connection and migrations use the direct one. Migrations are plain SQL in `backend/migrations/`.

## Roadmap (in progress)

- [ ] **Release-aware ingestion.** A scheduled job checks CMS dataset metadata and only re-ingests when a new release is published, so users never wait on CMS. Every release is kept, which enables trends and "biggest movers".
- [ ] **Statistical rigor.** Confidence intervals, minimum case volumes and tie handling, so small hospitals don't top the rankings by chance.
- [ ] **Hospital strain.** Weekly CDC NHSN state hospital respiratory data, averaged over each CMS measure's own reporting window, to see how system strain relates to outcomes.
- [ ] **Spending.** Medicare spending per beneficiary by state, adjusted for regional prices, compared against outcomes.
- [ ] **Hospital explorer.** Search, per-hospital detail pages, and comparisons within each state.
- [ ] **Power BI report.** A star-schema `reporting` layer of SQL views feeding a Power BI report kept in the repo as a `.pbip` project.
- [ ] Tests, CI and a public deployment.

## Running locally

Requires Node 20+ and a Postgres database (the project uses Neon).

```bash
npm install
neon env pull                          # or create .env.local with DATABASE_URL and DATABASE_URL_UNPOOLED
npm run migrate --workspace=backend
npm run dev                            # backend on :3001, frontend on :5173
```

## Project history

- **April 2026**: first prototype: React dashboard, Express API, CMS integration and a JSON file cache.
- **May 2026**: about a dozen working sessions trying different AI coding agents on this project, on other machines. That code wasn't carried over, but the comparison shaped how the project is built now.
- **October 2026**: moved the data layer to Postgres on Neon with Claude Code and expanded the scope to strain, spending and Power BI.

## Data sources

- [CMS Provider Data Catalog](https://data.cms.gov/provider-data/), Hospitals: Timely and Effective Care, Complications and Deaths, HCAHPS, Unplanned Hospital Visits.

CMS publishes these measures roughly quarterly, and many cover multi-year windows that lag the release date. Rankings describe past performance; they aren't medical advice. The quips are jokes.
