-- Hospital-level context (ingest/context.ts). One current row per hospital;
-- each load replaces the previous one and is recorded in source_loads.

-- What the expected-score model adjusts for: patients, community and the
-- kind of care the hospital provides. All outside management's day-to-day
-- control, unlike finances and staffing (hospital_finance), which are shown
-- as diagnostics but deliberately not adjusted for.
CREATE TABLE hospital_context (
  facility_id        text PRIMARY KEY REFERENCES hospitals (facility_id),
  -- CMS IPPS impact file (subsection (d) hospitals only: no critical access
  -- hospitals, no Maryland)
  county_fips        char(5),
  rural              boolean,
  dsh_pct            float8,  -- low-income patient percentage (Medicaid + SSI days), 0-1
  case_mix_index     float8,  -- transfer-adjusted CMI: complexity of Medicare cases
  resident_bed_ratio float8,  -- teaching intensity
  -- HRRP supplemental file
  dual_proportion    float8,  -- share of Medicare stays with full Medicaid too, 0-1
  -- CDC/ATSDR Social Vulnerability Index, county of the hospital
  svi_percentile     float8,  -- 0-1, higher = more vulnerable
  poverty150_pct     float8,  -- % of residents below 150% of the poverty line
  uninsured_pct      float8,
  sources            jsonb NOT NULL,  -- which file versions each part came from
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Latest Medicare cost report per hospital (CMS Hospital Provider Cost
-- Report PUF). Money in dollars; shares 0-1.
CREATE TABLE hospital_finance (
  facility_id            text PRIMARY KEY REFERENCES hospitals (facility_id),
  fiscal_year_begin      date,
  fiscal_year_end        date NOT NULL,
  beds                   integer,
  net_patient_revenue    float8,
  total_other_income     float8,  -- grants, donations, appropriations, investment income, ...
  operating_expense      float8,
  net_income_patient     float8,  -- net income from service to patients
  net_income             float8,  -- after other income and expenses
  uncompensated_care     float8,
  charity_care           float8,
  total_costs            float8,
  total_days             float8,
  medicaid_days          float8,
  medicare_days          float8,
  bed_days_available     float8,
  fte_employees          float8,
  salaries               float8,
  contract_labor         float8,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Ratios computed from the raw cost-report figures. Divisions guard against
-- zero and missing values; extreme values are kept (filter when charting).
-- No days-cash-on-hand: the PUF's cash line excludes investments, so it would
-- understate liquidity badly (median ~9 days).
CREATE VIEW hospital_finance_ratios AS
SELECT f.facility_id, f.fiscal_year_end, f.beds,
       f.net_income_patient / NULLIF(f.net_patient_revenue, 0)                         AS patient_margin,
       f.net_income / NULLIF(f.net_patient_revenue + coalesce(f.total_other_income, 0), 0) AS total_margin,
       f.total_other_income / NULLIF(f.net_patient_revenue, 0)                         AS other_income_share,
       f.uncompensated_care / NULLIF(f.total_costs, 0)                                 AS uncompensated_share,
       f.medicaid_days / NULLIF(f.total_days, 0)                                       AS medicaid_day_share,
       f.medicare_days / NULLIF(f.total_days, 0)                                       AS medicare_day_share,
       f.total_days / NULLIF(f.bed_days_available, 0)                                  AS occupancy,
       f.fte_employees / NULLIF(f.beds, 0)                                             AS fte_per_bed,
       f.contract_labor / NULLIF(f.salaries, 0)                                        AS contract_labor_share
FROM hospital_finance f;
