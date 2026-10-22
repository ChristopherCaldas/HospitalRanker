-- Primary-care and urgent-care access around each hospital (ingest/access.ts).
-- The question: where people have nowhere else to go for routine and urgent
-- care, the ER does that job too. One current row per hospital; each load
-- replaces the previous one and is recorded in source_loads.
--
-- "Local" figures use ZIP code (ZCTA) centroids: the hospital's ZIP, every
-- ZCTA within the radius for population and income, and each site's ZIP or
-- coordinates. Approximate at the scale of a few miles.
CREATE TABLE hospital_access (
  facility_id              text PRIMARY KEY REFERENCES hospitals (facility_id),
  county_fips              char(5),
  -- County Health Rankings (county of the hospital)
  county_pcp_per_100k      float8,  -- primary care physicians
  county_other_pc_per_100k float8,  -- nurse practitioners, PAs, ... in primary care
  county_preventable_stays float8,  -- preventable hospital stays per 100k Medicare enrollees
  -- Medicare Geographic Variation PUF, county, Original Medicare beneficiaries
  county_er_visits_per_1000 float8,
  county_em_visits_per_1000 float8, -- office/outpatient evaluation & management visits
  -- Within LOCAL_MILES of the hospital's ZIP centroid
  local_population         float8,  -- ACS 5-year, sum over ZCTAs
  local_income             float8,  -- population-weighted mean of ZCTA median household income
  urgent_care_sites        integer, -- NPPES organizations with the urgent care taxonomy, by location address
  health_center_sites      integer, -- HRSA health center (FQHC + look-alike) permanent sites, schools excluded
  other_eds                integer, -- other hospitals with emergency services (Hospital General Information)
  sources                  jsonb NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
