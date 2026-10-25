import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { writeExpectedPerformance } from './expected'
import { writePredictors } from './predictors'
import { writeMovers } from './movers'
import { writeChain } from './chain'
import { writeEquity } from './equity'

// Part of the input fingerprint: bump when the analysis method changes so the
// next run re-computes even if no data changed.
const METHOD_VERSION = 'expected-v3'
const PREDICTORS_VERSION = 'predictors-v1'
const MOVERS_VERSION = 'movers-v1'
const CHAIN_VERSION = 'chain-v1'
const EQUITY_VERSION = 'equity-v1'

// Freezes the *_live analysis views into a new analysis run when the inputs
// (CMS release per measure, CDC and Medicare GV versions) differ from the
// latest run's. Run after ingestion.
//
//   npm run analyze --workspace=backend            # only if inputs changed
//   npm run analyze --workspace=backend -- --force # new run regardless

const force = process.argv.includes('--force')

const SNAPSHOTS = [
  ['analysis_state_measure', 'analysis_state_measure_live'],
  ['analysis_correlations', 'analysis_correlations_live'],
  ['analysis_hospital_percentiles', 'analysis_hospital_percentiles_live'],
] as const

async function main() {
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()

  try {
    const { rows: [{ inputs }] } = await db.query(`
      SELECT jsonb_build_object(
        'releases', (SELECT jsonb_object_agg(measure_id, release_id) FROM analysis_measure_windows),
        'cdc', (SELECT max(version) FROM source_loads WHERE source = 'cdc_nhsn_hrd'),
        'spend', (SELECT max(version) FROM source_loads WHERE source = 'cms_medicare_gv'),
        'context', (SELECT version FROM source_loads WHERE source = 'hospital_context' ORDER BY loaded_at DESC LIMIT 1),
        'method', $1::text,
        'changes', (SELECT version FROM source_loads WHERE source = 'hospital_changes' ORDER BY loaded_at DESC LIMIT 1),
        'predictors', $2::text,
        'movers', $3::text,
        'chain', $4::text,
        'equity', $5::text
      ) AS inputs`, [METHOD_VERSION, PREDICTORS_VERSION, MOVERS_VERSION, CHAIN_VERSION, EQUITY_VERSION])
    const { rows: [latest] } = await db.query('SELECT id, inputs FROM analysis_runs ORDER BY id DESC LIMIT 1')

    // jsonb equality ignores key order.
    const { rows: [{ same }] } = await db.query('SELECT $1::jsonb = $2::jsonb AS same', [
      JSON.stringify(inputs),
      JSON.stringify(latest?.inputs ?? null),
    ])
    if (same && !force) {
      console.log(`= inputs unchanged since run ${latest.id}`)
      return
    }

    await db.query('BEGIN')
    const { rows: [run] } = await db.query('INSERT INTO analysis_runs (inputs) VALUES ($1) RETURNING id', [inputs])
    for (const [table, view] of SNAPSHOTS) {
      const { rowCount } = await db.query(`INSERT INTO ${table} SELECT $1, * FROM ${view}`, [run.id])
      console.log(`  ${table}: ${rowCount} rows`)
    }
    await writeExpectedPerformance(db, run.id)
    await writeChain(db, run.id)
    await writeEquity(db, run.id)
    await writePredictors(db, run.id)
    await writeMovers(db, run.id)
    await db.query('COMMIT')
    console.log(`+ analysis run ${run.id}`)

    const { rows } = await db.query(`
      SELECT c.measure_id, m.higher_is_better AS hib, c.factor, c.n,
             round(c.r::numeric, 2) AS r,
             '[' || round(c.r_ci_low::numeric, 2) || ', ' || round(c.r_ci_high::numeric, 2) || ']' AS r_95ci,
             round(c.spearman::numeric, 2) AS rho,
             round(c.partial_r::numeric, 2) AS partial_r,
             round(c.partial_p_value::numeric, 3) AS partial_p,
             round(c.partial_q_value::numeric, 3) AS partial_q,
             CASE WHEN c.partial_q_value < 0.05 THEN '*' ELSE '' END AS fdr_5pct
      FROM analysis_correlations c JOIN measures m USING (measure_id)
      WHERE c.run_id = $1 ORDER BY c.measure_id, c.factor`, [run.id])
    console.table(rows)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
