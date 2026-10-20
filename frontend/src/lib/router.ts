import { useEffect, useState } from 'react'

// Minimal hash router: '#/states/mortality' -> ['states', 'mortality']. Hash
// routes need no server config, so deep links work on any static host.
export function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [route, setRoute] = useState(read)
  useEffect(() => {
    let section = read()[0]
    const onChange = () => {
      const next = read()
      setRoute(next)
      // New section: start at the top. Same section (e.g. a measure tab lower
      // on the page): keep the reader's place.
      if (next[0] !== section) window.scrollTo(0, 0)
      section = next[0]
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join('/')}`
