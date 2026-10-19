import { Router } from 'express'
import type { Request, Response } from 'express'
import { getStateAnalysis } from '../services/analysis'
import { CATEGORY_META } from '../services/categories'

const router = Router()

// GET /api/analysis/:category — per-state outcome, strain and spend for the
// category's measure, plus strain/spend correlations, from the latest snapshot.
router.get('/:category', async (req: Request, res: Response) => {
  const { category } = req.params
  const meta = CATEGORY_META[category]
  if (!meta) {
    res.status(404).json({ error: 'Unknown category' })
    return
  }

  try {
    const analysis = await getStateAnalysis(category)
    if (!analysis) {
      res.status(503).json({ error: 'No analysis run for this category yet' })
      return
    }
    res.json({ category, label: meta.label, ...analysis })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch analysis' })
  }
})

export default router
