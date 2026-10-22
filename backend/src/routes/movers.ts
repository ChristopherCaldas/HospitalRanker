import { Router } from 'express'
import type { Request, Response } from 'express'
import { getMovers } from '../services/movers'

const router = Router()

// GET /api/movers — real change vs. noise and regression to the mean, the
// hospitals that clearly changed, and what predicts change.
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getMovers())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch movers' })
  }
})

export default router
