-- Equity analysis (analysis/equity.ts): results and money by fifth of
-- dual-eligible share, and each hospital's rank within its fifth.
CREATE TABLE analysis_equity_fifths (
  run_id    integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  fifth     integer NOT NULL,   -- 1 = fewest dual-eligible patients
  dual_low  float8  NOT NULL,
  dual_high float8  NOT NULL,
  hospitals integer NOT NULL,
  scores    jsonb   NOT NULL,   -- scope -> {raw, adjusted, n}: mean scores, tau units
  money     jsonb   NOT NULL,   -- metric -> {median, n}
  within    jsonb   NOT NULL,   -- metric -> {spearman, n}: vs adjusted overall score within the fifth
  PRIMARY KEY (run_id, fifth)
);

CREATE VIEW analysis_latest_equity_fifths AS
SELECT * FROM analysis_equity_fifths WHERE run_id = (SELECT max(id) FROM analysis_runs);

-- Rank on the unadjusted overall score among hospitals in the same fifth
-- (the Hospital Readmissions Reduction Program's peer-group comparison).
CREATE TABLE analysis_hospital_peer (
  run_id      integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  facility_id text    NOT NULL,
  fifth       integer NOT NULL,
  raw_score   float8  NOT NULL,
  peer_rank   integer NOT NULL,
  peer_count  integer NOT NULL,
  PRIMARY KEY (run_id, facility_id)
);

CREATE VIEW analysis_latest_hospital_peer AS
SELECT * FROM analysis_hospital_peer WHERE run_id = (SELECT max(id) FROM analysis_runs);
