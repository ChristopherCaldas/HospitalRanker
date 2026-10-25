import { href } from '../lib/router'

// Static background page: Donabedian's quality framework and where this site's measures sit in it.

const TRIAD = [
  {
    name: 'Structure',
    question: 'What does the hospital have?',
    text: 'The setting care happens in: buildings, equipment, staff and how the organization is run.',
    examples: ['Facilities and safety design', 'Staffing levels and credentials', 'Technology such as electronic records and imaging'],
    here: (
      <>
        Hospital type and ownership, teaching intensity (residents per bed), case mix, staff pay and cost per discharge,
        margins and debt. See <a href={href('finances')} className="text-blue-700 hover:underline">Finances</a> and{' '}
        <a href={href('predictors')} className="text-blue-700 hover:underline">What predicts results</a>.
      </>
    ),
  },
  {
    name: 'Process',
    question: 'What does the hospital do?',
    text: 'The care itself: the tests ordered, the treatments given, how quickly, and how staff treat patients.',
    examples: ['Ordering the right tests', 'Following treatment protocols', 'Communicating with patients'],
    here: (
      <>
        <strong>ER wait times</strong> (how long patients spend in the emergency room) and <strong>satisfaction</strong>{' '}
        (patients' ratings of how well nurses communicated, which Donabedian counted as the interpersonal side of care).
      </>
    ),
  },
  {
    name: 'Outcome',
    question: 'What happened to the patient?',
    text: "Changes in patients' health that can be traced back to the care they got. Donabedian called outcomes the final validator.",
    examples: ['Survival and recovery', 'Patient experience', 'Return trips to the hospital'],
    here: (
      <>
        <strong>Mortality</strong> (deaths within 30 days of a heart attack), <strong>patient safety</strong> (preventable
        complications) and <strong>readmissions</strong> (heart-failure patients back within 30 days).
      </>
    ),
  },
]

// Donabedian, "The seven pillars of quality," Archives of Pathology & Laboratory Medicine, 1990.
const PILLARS = [
  { name: 'Efficacy', text: 'The best results care can achieve under ideal conditions.' },
  { name: 'Effectiveness', text: 'How close everyday care comes to that ideal.' },
  { name: 'Efficiency', text: 'Getting the same results for less money.' },
  { name: 'Optimality', text: 'Spending up to the point where extra care stops being worth its cost, and no further.' },
  { name: 'Acceptability', text: "Fitting patients' wishes and expectations: access, the patient–doctor relationship, comfort, and how results and costs are weighed." },
  { name: 'Legitimacy', text: "Fitting society's view of what's fair and worth paying for." },
  { name: 'Equity', text: 'Distributing care and its benefits fairly across the population.' },
]

const RATERS = [
  {
    name: 'U.S. News & World Report',
    purpose: 'Finding the best hospital for complex or rare conditions, specialty by specialty',
    data: 'Medicare claims, the American Hospital Association survey, physician surveys',
    reputation: 'Yes, from surveys of specialists, though its weight has been cut',
    output: 'Ranked lists in 15 adult specialties, "high performing" ratings for common procedures, an Honor Roll',
  },
  {
    name: 'Healthgrades',
    purpose: 'Clinical results for specific procedures and conditions',
    data: 'Medicare claims plus state all-payer data where available',
    reputation: 'No',
    output: '1, 3 or 5 stars for 31 procedures and conditions (actual vs. expected deaths and complications); Best Hospitals awards',
  },
  {
    name: 'CMS Overall Star Rating',
    purpose: 'A broad public summary of quality, safety and patient experience',
    data: 'Measures hospitals report to Medicare',
    reputation: 'No',
    output: 'One rating from 1 to 5 stars. Mortality, safety, readmission and patient experience count 22% each; timely and effective care 12%',
  },
  {
    name: 'HospitalRanker (this site)',
    purpose: 'Showing how hospitals compare on five measures, and which beat what their circumstances predict',
    data: 'Medicare (CMS) public measures and cost reports, CDC, Census and county data',
    reputation: 'No',
    output: 'Best and worst five per measure, expected vs. actual scores with "clear cases only" verdicts',
  },
]

export default function FrameworkView() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">How quality is measured</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">
          Almost every hospital report card, this one included, builds on the work of Avedis Donabedian (1919–2000), a
          physician born in Beirut who spent his career at the University of Michigan. His 1966 paper{' '}
          <em>Evaluating the Quality of Medical Care</em> turned "good care" from a matter of opinion into something that
          could be measured. This page summarizes his framework and shows where the numbers on this site fit into it.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Structure, process, outcome</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Donabedian sorted every measure of quality into three groups, linked in a chain:
          </p>
          <blockquote className="mt-3 border-l-4 border-blue-300 pl-4 text-sm text-gray-700 italic max-w-3xl">
            "Good structure increases the likelihood of good process, and good process increases the likelihood of good
            outcome."
          </blockquote>
        </div>
        <ol className="grid md:grid-cols-3 gap-3">
          {TRIAD.map((t, i) => (
            <li key={t.name} className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-2 text-sm">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {i + 1} of 3{i < 2 && <span aria-hidden="true"> →</span>}
              </div>
              <div>
                <h4 className="text-base font-semibold text-gray-900">{t.name}</h4>
                <p className="text-gray-500">{t.question}</p>
              </div>
              <p className="text-gray-700">{t.text}</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-0.5">
                {t.examples.map(e => <li key={e}>{e}</li>)}
              </ul>
              <p className="mt-auto pt-2 border-t border-gray-100 text-gray-600">
                <span className="font-medium text-gray-800">On this site: </span>
                {t.here}
              </p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-gray-600 max-w-3xl leading-relaxed">
          The key word is <em>likelihood</em>. Good staffing or equipment doesn't guarantee good care, and good care
          doesn't guarantee every patient survives, so a fair grade has to check the links rather than assume them. That's
          why this site's <a href={href('performance')} className="text-blue-700 hover:underline">expected scores</a>{' '}
          adjust only for things outside a hospital's control (its patients and community) and leave structure that
          management chooses, like money and staffing, as something to test on the{' '}
          <a href={href('predictors')} className="text-blue-700 hover:underline">What predicts results</a> page.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">The seven pillars of quality</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Later, in 1990, Donabedian listed seven things that together make up quality. No single score covers them
            all; most report cards, this one included, mainly measure effectiveness.
          </p>
        </div>
        <dl className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {PILLARS.map(p => (
            <div key={p.name} className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
              <dt className="font-semibold text-gray-900">{p.name}</dt>
              <dd className="text-gray-600 mt-1">{p.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">How the best-known ratings use it</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            The major hospital ratings draw on the same framework but weigh it differently, so the same hospital can look
            quite different in each. In short: U.S. News rewards reputation and complex care, Healthgrades rewards
            clinical results, and CMS rewards broad accountability.
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Rating</th>
                <th className="px-4 py-2 text-left">Built for</th>
                <th className="px-4 py-2 text-left">Data</th>
                <th className="px-4 py-2 text-left">Uses reputation?</th>
                <th className="px-4 py-2 text-left">What you get</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 align-top">
              {RATERS.map((r, i) => (
                <tr key={r.name} className={i === RATERS.length - 1 ? 'bg-blue-50/50' : undefined}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-gray-900">{r.name}</th>
                  <td className="px-4 py-2 text-gray-600">{r.purpose}</td>
                  <td className="px-4 py-2 text-gray-600">{r.data}</td>
                  <td className="px-4 py-2 text-gray-600">{r.reputation}</td>
                  <td className="px-4 py-2 text-gray-600">{r.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-600 max-w-3xl">
          The <a href={href('performance')} className="text-blue-700 hover:underline">Expected vs. actual</a> page compares
          this site's results with CMS's star rating and the U.S. News Honor Roll.
        </p>
      </section>

      <figure className="max-w-3xl">
        <blockquote className="border-l-4 border-blue-300 pl-4 text-gray-700 italic">
          "Systems awareness and design are important… but are not enough. Ultimately, the secret of quality is love."
        </blockquote>
        <figcaption className="pl-5 mt-1 text-sm text-gray-500">Avedis Donabedian, in a 2000 interview</figcaption>
      </figure>
    </main>
  )
}
