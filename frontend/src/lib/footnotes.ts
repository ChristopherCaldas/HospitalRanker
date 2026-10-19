// CMS's own footnote text, from the Provider Data Catalog "Footnote Crosswalk"
// dataset (y9us-9xdf). Scores can carry several codes, e.g. "1, 29".
const FOOTNOTES: Record<string, string> = {
  '1': 'The number of cases/patients is too few to report.',
  '2': 'Data submitted were based on a sample of cases/patients.',
  '3': 'Results are based on a shorter time period than required.',
  '4': 'Data suppressed by CMS for one or more quarters.',
  '5': 'Results are not available for this reporting period.',
  '6': 'Fewer than 100 patients completed the CAHPS survey. Use these scores with caution, as the number of surveys may be too low to reliably assess facility performance.',
  '7': 'No cases met the criteria for this measure.',
  '9': 'No data are available from the state/territory for this reporting period.',
  '10': 'Very few patients were eligible for the CAHPS survey. The scores shown reflect fewer than 50 completed surveys. Use these scores with caution, as the number of surveys may be too low to reliably assess facility performance.',
  '11': 'There were discrepancies in the data collection process.',
  '12': 'This measure does not apply to this hospital for this reporting period.',
  '13': 'Results cannot be calculated for this reporting period.',
  '14': 'The results for this state are combined with nearby states to protect confidentiality.',
  '15': 'The number of cases/patients is too few to report a star rating.',
  '16': 'There are too few measures or measure groups reported to calculate a star rating or measure group score.',
  '19': 'Data are shown only for hospitals that participate in the Inpatient Quality Reporting (IQR) and Outpatient Quality Reporting (OQR) programs.',
  '23': 'The data are based on claims that the hospital or facility submitted to CMS. The hospital or facility has reported discrepancies in their claims data.',
  '24': 'Results for this Veterans Health Administration (VHA) hospital are combined with those from the VHA administrative parent hospital that manages all points of service.',
  '28': "The results are based on the hospital or facility's data submissions. CMS approved the hospital or facility's Extraordinary Circumstances Exception request suggesting that results may be impacted.",
  '29': "This measure was calculated using partial performance period data due to a CMS-approved exception.",
}

export function footnoteText(codes: string | null): string[] {
  if (!codes) return []
  return codes.split(',').map(c => c.trim()).filter(Boolean).map(c => FOOTNOTES[c] ?? `CMS footnote ${c}.`)
}
