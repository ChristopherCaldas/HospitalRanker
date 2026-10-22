import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// Route tests with the data layer mocked out: they cover routing, validation
// and status codes. The SQL itself is covered by analysis.sql.test.ts.
vi.mock('../src/db/pool', () => ({ pool: { query: vi.fn() } }))
vi.mock('../src/services/rankings', () => ({ getRanking: vi.fn() }))
vi.mock('../src/services/analysis', () => ({ getStateAnalysis: vi.fn() }))
vi.mock('../src/services/hospitals', () => ({ searchHospitals: vi.fn(), getHospital: vi.fn() }))
vi.mock('../src/services/finances', () => ({ getFinanceOverview: vi.fn(), getHospitalFinance: vi.fn() }))
vi.mock('../src/services/history', () => ({ getHistories: vi.fn() }))
vi.mock('../src/services/predictors', () => ({ getPredictors: vi.fn() }))
vi.mock('../src/services/movers', () => ({ getMovers: vi.fn(), getHospitalMovers: vi.fn() }))
vi.mock('../src/services/performance', () => ({
  getHospitalPerformance: vi.fn(), getContextSummary: vi.fn(), getLeaderboard: vi.fn(),
  getMeasurePerformance: vi.fn(), getSpotlight: vi.fn(), getBenchmarks: vi.fn(),
}))

const { app } = await import('../src/app')
const { pool } = await import('../src/db/pool')
const { getRanking } = await import('../src/services/rankings')
const { getStateAnalysis } = await import('../src/services/analysis')
const { searchHospitals, getHospital } = await import('../src/services/hospitals')
const { getFinanceOverview, getHospitalFinance } = await import('../src/services/finances')
const { getHistories } = await import('../src/services/history')
const { getPredictors } = await import('../src/services/predictors')
const { getMovers, getHospitalMovers } = await import('../src/services/movers')
const { getHospitalPerformance } = await import('../src/services/performance')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/health', () => {
  it('reports ok when the database answers', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ db: 'neondb' }] } as never)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', db: 'neondb' })
  })

  it('returns 503 when the database is down', async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error('ECONNREFUSED'))
    expect((await request(app).get('/api/health')).status).toBe(503)
  })
})

describe('GET /api/rankings/:category', () => {
  it('404s an unknown category without touching the database', async () => {
    const res = await request(app).get('/api/rankings/vibes')
    expect(res.status).toBe(404)
    expect(getRanking).not.toHaveBeenCalled()
  })

  it('passes minCases through and merges category metadata', async () => {
    vi.mocked(getRanking).mockResolvedValue({ measureId: 'MORT_30_AMI', top5: [], bottom5: [] } as never)
    const res = await request(app).get('/api/rankings/mortality?minCases=100')
    expect(getRanking).toHaveBeenCalledWith('mortality', 100)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ category: 'mortality', label: '30-Day Mortality', measureId: 'MORT_30_AMI' })
  })

  it('treats a junk minCases as 0', async () => {
    vi.mocked(getRanking).mockResolvedValue({ top5: [], bottom5: [] } as never)
    await request(app).get('/api/rankings/mortality?minCases=lots')
    expect(getRanking).toHaveBeenCalledWith('mortality', 0)
  })

  it('returns 503 before any data is ingested', async () => {
    vi.mocked(getRanking).mockResolvedValue(null)
    expect((await request(app).get('/api/rankings/safety')).status).toBe(503)
  })

  it('returns 500 when the query fails', async () => {
    vi.mocked(getRanking).mockRejectedValue(new Error('boom'))
    expect((await request(app).get('/api/rankings/safety')).status).toBe(500)
  })
})

describe('GET /api/analysis/:category', () => {
  it('404s an unknown category and 503s before the first analysis run', async () => {
    expect((await request(app).get('/api/analysis/vibes')).status).toBe(404)
    vi.mocked(getStateAnalysis).mockResolvedValue(null)
    expect((await request(app).get('/api/analysis/wait_times')).status).toBe(503)
  })
})

describe('GET /api/hospitals', () => {
  it('only accepts a two-letter uppercase state filter', async () => {
    vi.mocked(searchHospitals).mockResolvedValue([])
    await request(app).get('/api/hospitals?q=mayo&state=MN')
    expect(searchHospitals).toHaveBeenLastCalledWith('mayo', 'MN', 20)
    await request(app).get("/api/hospitals?q=mayo&state=MN';--")
    expect(searchHospitals).toHaveBeenLastCalledWith('mayo', null, 20)
  })

  it('404s an unknown hospital id', async () => {
    vi.mocked(getHospital).mockResolvedValue(null)
    expect((await request(app).get('/api/hospitals/999999')).status).toBe(404)
  })

  it('adds history, finances, context and curated notes to a hospital', async () => {
    vi.mocked(getHospital).mockResolvedValue({ id: '330399', name: 'St Barnabas', measures: [] } as never)
    vi.mocked(getHospitalPerformance).mockResolvedValue({ measures: [], overall: null })
    vi.mocked(getHistories).mockResolvedValue({ '330399': { safety: [] } })
    vi.mocked(getHospitalFinance).mockResolvedValue({ finance: { beds: 283 }, context: null } as never)
    vi.mocked(getHospitalMovers).mockResolvedValue({ readmission: { verdict: 'declined', from: '2022-06-30', to: '2025-06-30', change: -3, changeSe: 0.5 } })
    const res = await request(app).get('/api/hospitals/330399')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      history: { safety: [] }, finance: { beds: 283 }, context: null, usNewsHonorRoll: false,
      movers: { readmission: { verdict: 'declined' } },
    })
    expect(res.body.notes.length).toBeGreaterThan(0)
  })
})

describe('GET /api/finances', () => {
  it('returns the overview, and 500 when the query fails', async () => {
    vi.mocked(getFinanceOverview).mockResolvedValue({ hospitals: 5188 } as never)
    expect((await request(app).get('/api/finances')).body).toEqual({ hospitals: 5188 })
    vi.mocked(getFinanceOverview).mockRejectedValue(new Error('boom'))
    expect((await request(app).get('/api/finances')).status).toBe(500)
  })
})

describe('GET /api/predictors', () => {
  it('returns the analysis, and 500 when the query fails', async () => {
    vi.mocked(getPredictors).mockResolvedValue({ runId: 12, computedAt: null, measures: [], correlations: [] })
    expect((await request(app).get('/api/predictors')).body).toMatchObject({ runId: 12 })
    vi.mocked(getPredictors).mockRejectedValue(new Error('boom'))
    expect((await request(app).get('/api/predictors')).status).toBe(500)
  })
})

describe('GET /api/movers', () => {
  it('returns the analysis, and 500 when the query fails', async () => {
    vi.mocked(getMovers).mockResolvedValue([])
    expect((await request(app).get('/api/movers')).body).toEqual([])
    vi.mocked(getMovers).mockRejectedValue(new Error('boom'))
    expect((await request(app).get('/api/movers')).status).toBe(500)
  })
})
