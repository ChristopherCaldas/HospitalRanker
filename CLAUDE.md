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
- `index.ts` — Express entry point, mounts `/api/rankings` router
- `routes/rankings.ts` — `GET /api/rankings/:category` — fetches, sorts, and returns top5/bottom5 with quips
- `services/cms.ts` — fetches from CMS Provider Data Catalog REST API; results cached in SQLite for 24h
- `services/quips.ts` — returns a random funny quip for best/worst hospital per category
- `db/cache.ts` — JSON file cache; lives in `data/cache.json` (gitignored). TTL is 24h, configurable via `CACHE_TTL_MS`.

### Frontend (`frontend/src/`)
- `App.tsx` — tab state, API fetching, top-level layout
- `types.ts` — shared TypeScript interfaces (`Hospital`, `CategoryRanking`, `Category`)
- `components/TabNav.tsx` — category tab bar
- `components/RankingSection.tsx` — two-column best/worst layout for a category
- `components/RankingTable.tsx` — table of 5 hospitals with name, location, score
- `components/QuipCard.tsx` — styled italic quip banner (green for best, red for worst)

Vite proxies `/api/*` to `localhost:3001` during development.

## Data Sources

| Category | CMS Dataset ID | Measure ID | Higher is better? |
|---|---|---|---|
| `wait_times` | `yv7e-xc69` (Timely Care) | `OP_18b` | No |
| `mortality` | `ynj2-r877` (Complications) | `MORT_30_AMI` | No |
| `safety` | `ynj2-r877` (Complications) | `PSI_90_SAFETY` | No |
| `satisfaction` | `dgck-syfz` (HCAHPS) | `H_COMP_1_STAR_RATING` | Yes |
| `readmission` | `632h-zaca` (Readmissions) | `READM_30_HOSP_WIDE` | No |

CMS data updates quarterly. The 24h cache TTL in `db/cache.ts` can be raised without issue.

## Adding a New Category

1. Add a measure entry to `MEASURE_MAP` in `backend/src/services/cms.ts`
2. Add metadata (label, description) to `CATEGORY_META` in `backend/src/routes/rankings.ts`
3. Add quip arrays to `QUIPS` in `backend/src/services/quips.ts`
4. Add the tab entry to `CATEGORIES` in `frontend/src/App.tsx`
5. Add the type to the `Category` union in `frontend/src/types.ts`
