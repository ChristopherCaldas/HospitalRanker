const QUIPS: Record<string, { best: string[]; worst: string[] }> = {
  wait_times: {
    best: [
      "They must have a time machine in the waiting room.",
      "Blink and you'll miss your turn — in a good way.",
      "Somehow faster than your coffee order.",
    ],
    worst: [
      "By the time you're seen, your illness will have graduated to 'vintage'.",
      "Pack snacks. And a change of clothes. And a novel.",
      "They've rebranded 'wait time' as 'an opportunity for personal growth'.",
    ],
  },
  mortality: {
    best: [
      "Statistically speaking, you'll probably leave alive. Probably.",
      "Where patients check in and actually check out — in the good way.",
      "Even the Grim Reaper has them on Do Not Disturb.",
    ],
    worst: [
      "Bold of you to assume this is a round trip.",
      "Their discharge rate and their other rate are uncomfortably similar.",
      "The hospital where 'outcome' is doing a lot of heavy lifting as a word.",
    ],
  },
  safety: {
    best: [
      "So safe, they probably bubble-wrap the bubble wrap.",
      "The floor is so clean you could perform surgery on it. Coincidentally, they do.",
      "Where 'oops' has been surgically removed from the vocabulary.",
    ],
    worst: [
      "Come in for a sprain, leave with a story.",
      "Their incident report binder has a sequel. And a prequel.",
      "They treat complications as 'bonus medical experiences'.",
    ],
  },
  satisfaction: {
    best: [
      "Patients leave happier than they arrived — which, given why they came, is impressive.",
      "Five stars. Genuinely. From people who were sick.",
      "The Ritz-Carlton of places you'd really rather not need.",
    ],
    worst: [
      "Their patient satisfaction surveys come pre-filled with frowns.",
      "Rated poorly by people who were just grateful to survive.",
      "They could learn customer service from the DMV.",
    ],
  },
  readmission: {
    best: [
      "They fix you so well you never want to come back. Mission accomplished.",
      "One and done. Like a spa, but for your internal organs.",
      "Their patients graduate and don't look back.",
    ],
    worst: [
      "Frequent flyer miles, but make it medical.",
      "They treat patients like boomerangs — and with similar accuracy.",
      "The revolving door isn't just architectural.",
    ],
  },
}

export function getQuips(category: string): { best: string; worst: string } {
  const pool = QUIPS[category] ?? QUIPS['safety']
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
  return { best: pick(pool.best), worst: pick(pool.worst) }
}
