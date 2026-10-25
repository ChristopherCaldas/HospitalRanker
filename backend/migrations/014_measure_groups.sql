-- Where each measure sits in Donabedian's framework (domain) and in the CMS
-- Overall Star Rating's measure groups (quality_group), plus the measures
-- needed to fill those groups out. The five category measures keep backing the
-- Rankings and States pages; the rest have no category and feed the expected
-- model, the group/domain scores and hospital pages.
--
-- Patient experience straddles the framework: communication, cleanliness and
-- quiet are patients' reports of the care itself (process), while the overall
-- rating and willingness to recommend are satisfaction, which Donabedian
-- counted as an outcome.
ALTER TABLE measures
  ADD COLUMN domain text CHECK (domain IN ('process', 'outcome', 'cost')),
  ADD COLUMN quality_group text CHECK (quality_group IN ('mortality', 'safety', 'readmission', 'experience', 'timely_effective'));

UPDATE measures m SET domain = v.domain, quality_group = v.quality_group
FROM (VALUES
  ('OP_18b',               'process', 'timely_effective'),
  ('MORT_30_AMI',          'outcome', 'mortality'),
  ('PSI_90',               'outcome', 'safety'),
  ('H_COMP_1_STAR_RATING', 'process', 'experience'),
  ('READM_30_HF',          'outcome', 'readmission')
) AS v (measure_id, domain, quality_group)
WHERE m.measure_id = v.measure_id;

INSERT INTO measures (measure_id, dataset_id, name, higher_is_better, unit, domain, quality_group) VALUES
  -- Complications and Deaths
  ('MORT_30_HF',               'ynj2-r877', '30-day heart failure mortality rate',                  false, 'percent', 'outcome', 'mortality'),
  ('MORT_30_PN',               'ynj2-r877', '30-day pneumonia mortality rate',                      false, 'percent', 'outcome', 'mortality'),
  ('MORT_30_COPD',             'ynj2-r877', '30-day COPD mortality rate',                           false, 'percent', 'outcome', 'mortality'),
  ('MORT_30_STK',              'ynj2-r877', '30-day stroke mortality rate',                         false, 'percent', 'outcome', 'mortality'),
  ('MORT_30_CABG',             'ynj2-r877', '30-day bypass surgery (CABG) mortality rate',          false, 'percent', 'outcome', 'mortality'),
  ('COMP_HIP_KNEE',            'ynj2-r877', 'Hip/knee replacement complication rate',               false, 'percent', 'outcome', 'safety'),
  -- Healthcare Associated Infections: standardized infection ratios (observed / predicted)
  ('HAI_1_SIR',                '77hc-ibv8', 'Central line bloodstream infections (CLABSI)',         false, 'ratio',   'outcome', 'safety'),
  ('HAI_2_SIR',                '77hc-ibv8', 'Catheter urinary tract infections (CAUTI)',            false, 'ratio',   'outcome', 'safety'),
  ('HAI_3_SIR',                '77hc-ibv8', 'Surgical site infections after colon surgery',         false, 'ratio',   'outcome', 'safety'),
  ('HAI_4_SIR',                '77hc-ibv8', 'Surgical site infections after abdominal hysterectomy', false, 'ratio',  'outcome', 'safety'),
  ('HAI_5_SIR',                '77hc-ibv8', 'MRSA bloodstream infections',                          false, 'ratio',   'outcome', 'safety'),
  ('HAI_6_SIR',                '77hc-ibv8', 'C. diff infections',                                   false, 'ratio',   'outcome', 'safety'),
  -- Unplanned Hospital Visits
  ('READM_30_AMI',             '632h-zaca', '30-day heart attack readmission rate',                 false, 'percent', 'outcome', 'readmission'),
  ('READM_30_PN',              '632h-zaca', '30-day pneumonia readmission rate',                    false, 'percent', 'outcome', 'readmission'),
  ('READM_30_COPD',            '632h-zaca', '30-day COPD readmission rate',                         false, 'percent', 'outcome', 'readmission'),
  ('READM_30_CABG',            '632h-zaca', '30-day bypass surgery (CABG) readmission rate',        false, 'percent', 'outcome', 'readmission'),
  ('READM_30_HIP_KNEE',        '632h-zaca', '30-day hip/knee replacement readmission rate',         false, 'percent', 'outcome', 'readmission'),
  -- Patient survey (HCAHPS) star ratings
  ('H_COMP_2_STAR_RATING',     'dgck-syfz', 'Doctor communication star rating (HCAHPS)',            true,  'stars',   'process', 'experience'),
  ('H_COMP_5_STAR_RATING',     'dgck-syfz', 'Communication about medicines star rating (HCAHPS)',   true,  'stars',   'process', 'experience'),
  ('H_COMP_6_STAR_RATING',     'dgck-syfz', 'Discharge information star rating (HCAHPS)',           true,  'stars',   'process', 'experience'),
  ('H_CLEAN_STAR_RATING',      'dgck-syfz', 'Cleanliness star rating (HCAHPS)',                     true,  'stars',   'process', 'experience'),
  ('H_QUIET_STAR_RATING',      'dgck-syfz', 'Quietness star rating (HCAHPS)',                       true,  'stars',   'process', 'experience'),
  ('H_HSP_RATING_STAR_RATING', 'dgck-syfz', 'Overall hospital rating star rating (HCAHPS)',         true,  'stars',   'outcome', 'experience'),
  ('H_RECMND_STAR_RATING',     'dgck-syfz', 'Would recommend the hospital star rating (HCAHPS)',    true,  'stars',   'outcome', 'experience'),
  -- Timely and Effective Care
  ('SEP_1',                    'yv7e-xc69', 'Appropriate care for severe sepsis and septic shock',  true,  'percent', 'process', 'timely_effective'),
  ('OP_23',                    'yv7e-xc69', 'Head CT read within 45 minutes for stroke symptoms',   true,  'percent', 'process', 'timely_effective'),
  ('OP_22',                    'yv7e-xc69', 'Left the emergency department before being seen',     false, 'percent', 'process', 'timely_effective'),
  ('IMM_3',                    'yv7e-xc69', 'Healthcare workers given influenza vaccination',       true,  'percent', 'process', 'timely_effective'),
  -- Medicare Spending Per Beneficiary: Medicare payments from 3 days before
  -- to 30 days after a stay, price-standardized and risk-adjusted, as a ratio
  -- to the national median. What the payer spends, not the hospital's cost.
  ('MSPB-1',                   'rrqw-56er', 'Medicare spending per beneficiary (ratio to national)', false, 'ratio',  'cost',    NULL);
