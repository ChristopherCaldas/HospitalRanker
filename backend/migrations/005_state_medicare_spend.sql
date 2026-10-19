-- CMS Medicare Geographic Variation PUF, state level, all ages, 2014 onward.
-- Covers Original Medicare (fee-for-service) beneficiaries only; Medicare
-- Advantage enrollment varies widely by state, so ma_participation_rate is
-- kept for adjustment. *_stdzd_* payments remove geographic price
-- differences (wage index, GME/IME etc.), which makes states comparable.
-- The file has no risk score, so spending is price- but not risk-adjusted.
CREATE TABLE state_medicare_spend (
  state                 char(2)  NOT NULL,     -- includes DC, PR, VI
  year                  smallint NOT NULL,
  benes_total           integer,
  benes_ffs             integer,              -- Original Medicare (BENES_OM_CNT)
  ma_participation_rate numeric,              -- 0-1
  avg_age               numeric,
  dual_eligible_pct     numeric,              -- 0-1, Medicare + Medicaid
  total_pymt_pc         numeric,              -- actual $ per FFS beneficiary
  total_stdzd_pymt_pc   numeric,              -- price-standardized $ per FFS beneficiary
  ip_pymt_pc            numeric,              -- inpatient only
  ip_stdzd_pymt_pc      numeric,
  readmission_pct       numeric,              -- 0-1, acute hospital readmissions
  er_visits_per_1000    numeric,
  PRIMARY KEY (state, year)
);
