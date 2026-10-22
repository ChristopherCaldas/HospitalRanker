import { Router } from 'express'
import type { Request, Response } from 'express'
import { getPredictors } from '../services/predictors'

const router = Router()

// GET /api/predictors — which hospital facts predict actual scores, how
// lasting a track record is, and how measures relate to each other.
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getPredictors())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch predictors' })
  }
})

export default router
