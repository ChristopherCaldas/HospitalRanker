import { Router } from 'express'
import type { Request, Response } from 'express'
import { MAX_MILES, nearbyHospitals, originFromPoint, originFromZip } from '../services/nearby'
import { SCOPES, type Scope } from '../services/performance'

const router = Router()

// GET /api/nearby?zip=&miles=&scope=  or  ?lat=&lon=&miles=&scope=
// Every hospital within `miles` (default 25, max 100), best first on `scope`.
router.get('/', async (req: Request, res: Response) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'overall'
  if (!(SCOPES as readonly string[]).includes(scope)) {
    res.status(400).json({ error: 'Unknown scope' })
    return
  }
  const miles = req.query.miles === undefined ? 25 : Number(req.query.miles)
  if (!Number.isFinite(miles) || miles <= 0 || miles > MAX_MILES) {
    res.status(400).json({ error: `miles must be between 1 and ${MAX_MILES}` })
    return
  }
  const zip = typeof req.query.zip === 'string' ? req.query.zip.trim() : ''
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  const hasPoint = req.query.lat !== undefined && req.query.lon !== undefined
  if (zip ? !/^\d{5}$/.test(zip) : !hasPoint || !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
    res.status(400).json({ error: 'Give a 5-digit ZIP code or lat and lon' })
    return
  }
  try {
    const origin = zip ? await originFromZip(zip) : await originFromPoint(lat, lon)
    if (!origin) {
      res.status(404).json({ error: zip ? 'Unknown ZIP code' : 'No U.S. ZIP code near that location' })
      return
    }
    const hospitals = await nearbyHospitals(origin, miles, scope as Scope)
    res.set('Cache-Control', 'private, no-store')
    res.json({ origin: { zip: origin.zip, approximate: origin.approximate }, miles, scope, hospitals })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to search nearby hospitals' })
  }
})

export default router
