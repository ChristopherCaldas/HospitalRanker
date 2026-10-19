// Vercel serverless entry point: the same Express app as `npm run dev`.
// vercel.json rewrites /api/* here; the static frontend is served by the CDN.
import { app } from '../backend/src/app'

export default app
