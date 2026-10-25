import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FrameworkView from './FrameworkView'

describe('FrameworkView', () => {
  it('renders the triad, all seven pillars and the ratings table', () => {
    const html = renderToStaticMarkup(<FrameworkView />)
    for (const word of ['Structure', 'Process', 'Outcome']) expect(html).toContain(`>${word}</h4>`)
    expect(html.match(/<dt /g)).toHaveLength(7)
    expect(html).toContain('HospitalRanker (this site)')
  })
})
