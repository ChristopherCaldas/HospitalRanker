// CMS intermittently returns 503s and HTML error pages, so every network call
// goes through this with exponential backoff.
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  { attempts = 5, baseDelayMs = 2000 } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`${label} failed (attempt ${attempt}/${attempts}): ${(err as Error).message}; retrying in ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
