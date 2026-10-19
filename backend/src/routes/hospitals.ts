import { Router } from 'express'
import type { Request, Response } from 'express'
import { getHospital, searchHospitals } from '../services/hospitals'
import { getHospitalPerformance } from '../services/performance'

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
    res.json({ ...hospital, performance: await getHospitalPerformance(req.params.id) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch hospital' })
  }
})

export default router
