import { Router } from 'express'
import type { Request, Response } from 'express'
import { getContextSummary, getLeaderboard, getMeasurePerformance } from '../services/performance'
import { CATEGORY_META } from '../services/categories'

const router = Router()

const stateParam = (req: Request) =>
  typeof req.query.state === 'string' && /^[A-Z]{2}$/.test(req.query.state) ? req.query.state : null
const limitParam = (req: Request) => Number(req.query.limit) || 10

// GET /api/performance/context — does context matter? One row per measure.
router.get('/context', async (_req: Request, res: Response) => {
  try {
    const rows = await getContextSummary()
    res.json(rows.map(r => ({ ...r, label: CATEGORY_META[r.category]?.label ?? r.measureId })))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch context summary' })
  }
})

// GET /api/performance?state=&limit= — overall context-adjusted leaderboard.
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await getLeaderboard(stateParam(req), limitParam(req)))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch leaderboard' })
  }
})

// GET /api/performance/:category?state=&limit= — over/under-performers on one measure.
router.get('/:category', async (req: Request, res: Response) => {
  const { category } = req.params
  const meta = CATEGORY_META[category]
  if (!meta) {
    res.status(404).json({ error: 'Unknown category' })
    return
  }
  try {
    const result = await getMeasurePerformance(category, stateParam(req), limitParam(req))
    if (!result) {
      res.status(503).json({ error: 'No analysis for this category yet' })
      return
    }
    res.json({ category, label: meta.label, ...result })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch performance' })
  }
})

export default router
