import { useEffect, useState } from 'react'

// Minimal hash router: '#/states/mortality' -> ['states', 'mortality']. Hash
// routes need no server config, so deep links work on any static host.
export function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => {
      setRoute(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join('/')}`
