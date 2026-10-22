import express from 'express'
import cors from 'cors'
import rankingsRouter from './routes/rankings'
import analysisRouter from './routes/analysis'
import hospitalsRouter from './routes/hospitals'
import performanceRouter from './routes/performance'
import financesRouter from './routes/finances'
import predictorsRouter from './routes/predictors'
import moversRouter from './routes/movers'
import { pool } from './db/pool'

// The Express app, separate from `listen` so tests can drive it directly.
export const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/rankings', rankingsRouter)
app.use('/api/analysis', analysisRouter)
app.use('/api/hospitals', hospitalsRouter)
app.use('/api/performance', performanceRouter)
app.use('/api/finances', financesRouter)
app.use('/api/predictors', predictorsRouter)
app.use('/api/movers', moversRouter)

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS db_time, current_database() AS db')
    res.json({ status: 'ok', ...rows[0] })
  } catch (err) {
    console.error(err)
    res.status(503).json({ status: 'error', error: 'Database unreachable' })
  }
})
