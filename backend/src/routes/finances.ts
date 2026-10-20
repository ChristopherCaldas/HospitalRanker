import { Router } from 'express'
import type { Request, Response } from 'express'
import { getFinanceOverview } from '../services/finances'

const router = Router()

// GET /api/finances — money by ownership, and finance metrics vs. the
// context-adjusted overall score.
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getFinanceOverview())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch finances' })
  }
})

export default router
