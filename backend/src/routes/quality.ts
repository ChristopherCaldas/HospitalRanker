import { Router } from 'express'
import type { Request, Response } from 'express'
import { getChain, getEquity, getValue } from '../services/quality'

const router = Router()

const send = (name: string, load: () => Promise<unknown>) => async (_req: Request, res: Response) => {
  try {
    const data = await load()
    if (data === null) res.status(404).json({ error: `No ${name} analysis yet` })
    else res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: `Failed to fetch ${name}` })
  }
}

// GET /api/quality/chain — structure -> process -> outcome tests.
router.get('/chain', send('chain', getChain))
// GET /api/quality/equity — results and money by fifth of dual-eligible share.
router.get('/equity', send('equity', getEquity))
// GET /api/quality/value — Medicare spending and hospital cost vs. outcomes.
router.get('/value', send('value', getValue))

export default router
