import { Router } from 'express'
import type { Request, Response } from 'express'
import { getRanking } from '../services/rankings'
import { CATEGORY_META } from '../services/categories'

const router = Router()

router.get('/:category', async (req: Request, res: Response) => {
  const { category } = req.params
  const meta = CATEGORY_META[category]

  if (!meta) {
    res.status(404).json({ error: 'Unknown category' })
    return
  }

  try {
    const ranking = await getRanking(category, Number(req.query.minCases) || 0)
    if (!ranking) {
      res.status(503).json({ error: 'No data ingested for this category yet' })
      return
    }

    res.json({
      category,
      label: meta.label,
      description: meta.description,
      technicalDescription: meta.technicalDescription,
      top5: ranking.top5,
      bottom5: ranking.bottom5,
      nationalMedian: ranking.nationalMedian,
      scoredHospitals: ranking.scoredHospitals,
      higherIsBetter: ranking.higherIsBetter,
      unit: ranking.unit,
      hasCaseCounts: ranking.hasCaseCounts,
      minCases: ranking.minCases,
      measureId: ranking.measureId,
      released: ranking.released,
      periodStart: ranking.periodStart,
      periodEnd: ranking.periodEnd,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch rankings' })
  }
})

export default router
