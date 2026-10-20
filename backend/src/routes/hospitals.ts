import { Router } from 'express'
import type { Request, Response } from 'express'
import { getHospital, searchHospitals } from '../services/hospitals'
import { getHospitalPerformance } from '../services/performance'
import { getHistories } from '../services/history'
import { getHospitalFinance } from '../services/finances'
import { HOSPITAL_NOTES, US_NEWS_HONOR_ROLL } from '../content/hospitalNotes'

const router = Router()

// GET /api/hospitals?q=&state=&limit=
router.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : ''
  const state = typeof req.query.state === 'string' && /^[A-Z]{2}$/.test(req.query.state) ? req.query.state : null
  try {
    res.json(await searchHospitals(q, state, Number(req.query.limit) || 20))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to search hospitals' })
  }
})

// GET /api/hospitals/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const hospital = await getHospital(req.params.id)
    if (!hospital) {
      res.status(404).json({ error: 'Unknown hospital' })
      return
    }
    const [performance, histories, money] = await Promise.all([
      getHospitalPerformance(req.params.id),
      getHistories([req.params.id]),
      getHospitalFinance(req.params.id),
    ])
    res.json({
      ...hospital,
      performance,
      finance: money.finance,
      context: money.context,
      history: histories[req.params.id],
      notes: HOSPITAL_NOTES[req.params.id] ?? [],
      usNewsHonorRoll: US_NEWS_HONOR_ROLL.facilityIds.includes(req.params.id),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch hospital' })
  }
})

export default router
