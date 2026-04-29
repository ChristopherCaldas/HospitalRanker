import express from 'express'
import cors from 'cors'
import rankingsRouter from './routes/rankings'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use('/api/rankings', rankingsRouter)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
