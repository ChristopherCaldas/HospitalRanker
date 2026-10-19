import express from 'express'
import cors from 'cors'
import rankingsRouter from './routes/rankings'
import { pool } from './db/pool'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use('/api/rankings', rankingsRouter)

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS db_time, current_database() AS db')
    res.json({ status: 'ok', ...rows[0] })
  } catch (err) {
    console.error(err)
    res.status(503).json({ status: 'error', error: 'Database unreachable' })
  }
})

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
