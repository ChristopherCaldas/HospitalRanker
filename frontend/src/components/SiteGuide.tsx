import { href } from '../lib/router'

export const SECTIONS = [
  { id: 'rankings', label: 'Rankings', blurb: 'The five best and five worst hospitals in the country on one topic. Pick the topic with the tabs below the header.' },
  { id: 'hospitals', label: 'Hospitals', blurb: 'Look up any hospital by name or city to see its full report card.' },
  { id: 'performance', label: 'Expected vs. actual', blurb: "Which hospitals do better or worse than you'd expect, given the patients and community they serve." },
  { id: 'predictors', label: 'What predicts results', blurb: 'Which facts about a hospital (money, staff, location, past results) go along with good scores.' },
  { id: 'movers', label: 'Movers', blurb: 'Hospitals that clearly got better or worse over the last few years.' },
  { id: 'states', label: 'States', blurb: 'How each state does, and whether crowded hospitals or Medicare spending make a difference.' },
  { id: 'finances', label: 'Finances', blurb: "Hospitals' money: who's losing money on patient care, and whether that goes along with quality." },
  { id: 'equity', label: 'Equity', blurb: 'Whether hospitals serving poorer patients get worse results, and whether that comes down to the patients or to money.' },
  { id: 'framework', label: 'Quality framework', blurb: "The structure–process–outcome framework behind hospital report cards, and where this site's numbers fit." },
]

// Orientation for first-time visitors. Open by default; it stays a click away once closed.
export default function SiteGuide() {
  return (
    <details open className="bg-blue-50 border border-blue-200 rounded-lg text-sm mb-6">
      <summary className="px-4 py-3 font-semibold text-blue-900 cursor-pointer select-none">
        New here? How to use this site
      </summary>
      <div className="px-4 pb-4 space-y-3 text-gray-700 leading-relaxed">
        <p>
          This site grades U.S. hospitals using public government data from Medicare (CMS) and the CDC. Nothing to sign up
          for or install: just click around. Every page starts with a short explanation, and boxes marked{' '}
          <span className="text-blue-600" aria-hidden="true">ⓘ</span> <em>How to read</em> explain the numbers. Click any
          hospital's name to open its report card.
        </p>
        <p>The links along the top of the page take you to each section:</p>
        <ul className="space-y-1.5">
          {SECTIONS.map(s => (
            <li key={s.id}>
              <a href={href(s.id)} className="font-medium text-blue-700 hover:underline">{s.label}</a>
              <span> — {s.blurb}</span>
            </li>
          ))}
        </ul>
        <p>
          The five topics: <strong>ER wait times</strong> (minutes spent in the emergency room),{' '}
          <strong>mortality</strong> (deaths within 30 days of a heart attack), <strong>patient safety</strong>{' '}
          (preventable complications), <strong>satisfaction</strong> (patients' ratings of nurses) and{' '}
          <strong>readmissions</strong> (heart-failure patients back in the hospital within 30 days). For most of them a
          lower number is better; each page says which way is good.
        </p>
        <p className="text-gray-500">
          A good place to start: open <a href={href('hospitals')} className="text-blue-700 hover:underline">Hospitals</a> and
          search for a hospital near you.
        </p>
      </div>
    </details>
  )
}
