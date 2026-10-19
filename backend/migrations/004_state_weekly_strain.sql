-- Loads of non-CMS sources. Unlike CMS releases these are revised in place,
-- so a load replaces rows rather than adding a snapshot; this table records
-- which upstream version was loaded and when.
CREATE TABLE source_loads (
  source     text NOT NULL,                  -- e.g. 'cdc_nhsn_hrd'
  version    text NOT NULL,                  -- upstream "last updated" marker
  row_count  integer NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, version)
);

-- CDC NHSN Weekly Hospital Respiratory Data, by jurisdiction (data.cdc.gov
-- ua7e-t2fy). Jurisdictions are state/territory codes plus 'USA' and HHS
-- regions. Coverage columns are the percent of hospitals reporting each
-- metric that week: during the voluntary period (May-Oct 2024) only ~37%
-- reported nationally, so counts from those weeks are not comparable and
-- percentages come from a self-selected subset.
CREATE TABLE state_weekly_strain (
  jurisdiction            text NOT NULL,
  week_ending             date NOT NULL,
  reporting_period        text NOT NULL
                          CHECK (reporting_period IN ('mandated_2020', 'voluntary_2024', 'mandated_2024')),
  hospitals_reporting     integer,
  inpatient_beds          integer,
  inpatient_beds_occupied integer,
  pct_inpatient_occupied  numeric,
  pct_inpatient_coverage  numeric,
  icu_beds                integer,
  icu_beds_occupied       integer,
  pct_icu_occupied        numeric,
  pct_icu_coverage        numeric,
  covid_admissions        integer,
  flu_admissions          integer,
  rsv_admissions          integer,
  pct_admissions_coverage numeric,
  PRIMARY KEY (jurisdiction, week_ending)
);
CREATE INDEX state_weekly_strain_week_idx ON state_weekly_strain (week_ending);
