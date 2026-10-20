// Hand-curated context for hospitals in the overall top and bottom 5
// (Expected vs. actual), plus outside rankings used as a sanity check.
//
// Rules for adding a note: link the original source, summarize in our own
// words (no copied passages), say when a claim is the hospital's own, and
// only include what the source itself confirms. Rankings move each CMS
// release, so notes are keyed by CMS facility ID and shown wherever that
// hospital appears; re-check them when the top/bottom lists change.

export interface HospitalNote {
  kind: 'news' | 'recognition' | 'rating'
  summary: string
  source: string
  url: string
  published: string // YYYY-MM-DD
}

export const NOTES_CHECKED = '2026-10-19'

export const HOSPITAL_NOTES: Record<string, HospitalNote[]> = {
  // NYU Langone Hospitals, New York NY
  '330214': [
    {
      kind: 'recognition',
      summary:
        'NYU Langone says Vizient ranked it No. 1 of 118 comprehensive academic medical centers for the fourth year in a row (hospital press release).',
      source: 'NYU Langone Health via BioSpace',
      url: 'https://www.biospace.com/press-releases/nyu-langone-health-once-again-holds-the-most-no-1-ranked-specialties-in-the-nation-in-u-s-news-world-report-rankings',
      published: '2026-08-04',
    },
  ],
  // UCHealth Memorial Hospital, Colorado Springs CO
  '060022': [
    {
      kind: 'recognition',
      summary:
        'Ranked No. 6 in Colorado by U.S. News for 2026–27, and described by UCHealth as the top-performing hospital in southern Colorado (hospital press release).',
      source: 'UCHealth',
      url: 'https://www.uchealth.org/today/u-s-news-world-report-others-rank-uchealth-hospitals-among-best-in-colorado-nation/',
      published: '2026-08-04',
    },
  ],
  // Mayo Clinic Hospital, Rochester MN
  '240010': [
    {
      kind: 'recognition',
      summary: "Ranked No. 1 on Newsweek's World's Best Hospitals list for the eighth straight year.",
      source: 'Rochester Post Bulletin',
      url: 'https://www.postbulletin.com/health/mayo-clinic-remains-newsweeks-no-1-hospital-in-the-world-per-2026-rankings',
      published: '2026-02-25',
    },
  ],
  // Mayo Clinic Hospital, Phoenix AZ
  '030103': [
    {
      kind: 'news',
      summary:
        'Announced a $1.9 billion expansion of the Phoenix campus: about 60% more clinical space, 11 operating rooms and 48 beds, to be finished by 2031.',
      source: 'KJZZ',
      url: 'https://www.kjzz.org/science/2025-03-03/mayo-clinic-makes-major-financial-investment-at-its-phoenix-campus-to-increase-clinical-space-by-60',
      published: '2025-03-03',
    },
  ],
  // NewYork-Presbyterian Hospital, New York NY
  '330101': [
    {
      kind: 'rating',
      summary:
        "Holds CMS's top five-star overall rating, which about 12% of rated hospitals earn (hospital press release).",
      source: 'NewYork-Presbyterian',
      url: 'https://www.nyp.org/news/newyork-presbyterian-achieves-5-star-rating-from-cms-for-high-quality-care',
      published: '2026-05-13',
    },
  ],
  // St Bernards Medical Center, Jonesboro AR: no recent coverage found.
  // St Barnabas Hospital (SBH Health System), Bronx NY
  '330399': [
    {
      kind: 'news',
      summary:
        'New York State backed up to $142 million for SBH and partners. The state says its emergency department sees about 75,000 visits a year in space built for 55,000.',
      source: 'Office of the Governor of New York',
      url: 'https://www.governor.ny.gov/news/making-investments-bronx-governor-hochul-announces-support-new-safety-net-hospital-partnership',
      published: '2025-01-30',
    },
    {
      kind: 'news',
      summary:
        'Filed plans for a roughly $132 million renovation to expand the emergency department and grow psychiatric beds from 49 to 72, phased through 2028.',
      source: 'Hoodline',
      url: 'https://hoodline.com/2026/05/bronx-hospital-s-132-million-bet-on-bigger-er-more-psych-beds/',
      published: '2026-05-04',
    },
  ],
  // Mississippi Baptist Medical Center, Jackson MS
  '250102': [
    {
      kind: 'recognition',
      summary:
        "Describes itself as U.S. News's No. 1 hospital in Mississippi seven years running, with 638 licensed beds (hospital press release).",
      source: 'Baptist Memorial Health Care',
      url: 'https://www.baptistonline.org/news/mississippi-baptist-medical-center-to-host-community-outreach-and-trauma-injury-prevention-event',
      published: '2026-07-07',
    },
  ],
  // Beebe Medical Center, Lewes DE
  '080007': [
    {
      kind: 'rating',
      summary:
        "Received a C in Leapfrog's fall 2023 safety grades, its second C, down from an A in spring 2020. The report singled out a low hand-hygiene score (40, against an average of 77).",
      source: 'WBOC',
      url: 'https://www.wboc.com/news/recent-assessment-raises-concerns-as-delaware-hospitals-lack-a-safety-ratings/article_84193b8a-8329-11ee-a679-d71f73e7250a.html',
      published: '2023-11-14',
    },
  ],
  // Erie County Medical Center, Buffalo NY
  '330219': [
    {
      kind: 'news',
      summary:
        'Topped off a new $58 million trauma and emergency department; officials expected staff to move in the following spring.',
      source: 'WBFO / Buffalo Toronto Public Media',
      url: 'https://www.btpm.org/health-wellness/2019-09-11/officials-say-new-ecmc-emergency-room-will-be-among-nations-best',
      published: '2019-09-11',
    },
  ],
}

// U.S. News Best Hospitals Honor Roll (unranked list of 20), matched to CMS
// facility IDs by name and city.
export const US_NEWS_HONOR_ROLL = {
  edition: '2026–27',
  published: '2026-08-04',
  url: 'https://health.usnews.com/health-care/best-hospitals/articles/best-hospitals-honor-roll-and-overview',
  facilityIds: [
    '220110', // Brigham and Women's Hospital
    '050625', // Cedars-Sinai Medical Center
    '360180', // Cleveland Clinic
    '390111', // Hospital of the University of Pennsylvania
    '450358', // Houston Methodist Hospital
    '210009', // Johns Hopkins Hospital
    '220071', // Massachusetts General Hospital
    '240010', // Mayo Clinic, Rochester
    '030103', // Mayo Clinic-Arizona, Phoenix
    '100151', // Mayo Clinic-Florida, Jacksonville
    '330024', // Mount Sinai Hospital
    '330101', // NewYork-Presbyterian Hospital-Columbia and Cornell
    '140281', // Northwestern Memorial Hospital
    '330214', // NYU Langone Hospitals
    '140119', // Rush University Medical Center
    '050441', // Stanford Health Care-Stanford Hospital
    '050025', // UC San Diego Health
    '050262', // UCLA Ronald Reagan Medical Center
    '050454', // UCSF Health-UCSF Medical Center
    '230046', // University of Michigan Health-Ann Arbor
  ],
}
