// Pure stock-grading function. Takes financial data, returns an A-F grade
// plus a breakdown of the 5 criteria. No I/O, no side effects — easy to test.
//
// The 5 criteria (each yes/no, sourced from Finnhub):
//   1. Topline revenue growth (long-term)   — latest annual revenue > earliest annual revenue
//   2. Recent revenue growth (TTM)          — TTM revenue > most recent annual revenue
//   3. Net positive free cash flow          — most recent FCF > 0
//   4. Free cash flow growth (long-term)    — latest annual FCF > earliest annual FCF
//   5. Recent free cash flow growth (TTM)   — TTM FCF > most recent annual FCF
//
// Score → grade mapping: 5=A, 4=B, 3=C, 2=D, 0–1=F.

// Map a count of yeses (0–5) to a letter grade.
const GRADE_BY_SCORE = ['F', 'F', 'D', 'C', 'B', 'A'];

// Some sectors do produce a revenue/FCF grade, but free cash flow is only a
// rough proxy for their real economics. When we can grade one of these, we
// attach a caveat (by Finnhub industry label) so users don't over-trust the
// letter. Banks have no FCF at all, so they hit the N/A path instead.
const SECTOR_CAVEATS = {
  'Real Estate': 'This is a REIT. REITs are usually judged on Funds From Operations (FFO) and dividend coverage rather than free cash flow, so treat this grade as a rough proxy.',
  'Insurance': 'Insurers don\'t have traditional free cash flow, so this grade is a rough proxy — also weigh book-value growth, the combined ratio, and return on equity.',
  'Utilities': 'Utilities are capital-intensive and often run negative free cash flow by design, so this grade is a rough proxy — also weigh dividend stability and regulated returns.',
};

// Build a single criterion result. `passed` is true / false / null (null = N/A).
function buildCriterion(name, value, prior, source) {
  if (value == null || prior == null) {
    return { name, passed: null, value: value ?? null, prior: prior ?? null, source };
  }
  return { name, passed: value > prior, value, prior, source };
}

// Same as buildCriterion but the test is `value > 0`.
function buildPositiveCriterion(name, value, source) {
  if (value == null) {
    return { name, passed: null, value: null, prior: 0, source };
  }
  return { name, passed: value > 0, value, prior: 0, source };
}

// How old the most recent annual report may be before we treat the data as
// stale and refuse to grade. ~2 years, measured precisely from the report's
// period-end date.
const STALE_AFTER_MONTHS = 24;

// Whole months between a past date and `now`.
function monthsBetween(past, now) {
  return (now.getFullYear() - past.getFullYear()) * 12 + (now.getMonth() - past.getMonth());
}

// Decide whether the financial data is too old to grade. Prefers the report's
// exact period-end date (handles off-calendar fiscal years and avoids a
// year-boundary cliff); falls back to the report year if no date is available.
// Returns { stale, label } where label is the year shown in the N/A message.
function checkStale(data, now) {
  const endRaw = data.latestAnnualEndDate;
  if (endRaw) {
    // Finnhub formats dates like "2023-12-31 00:00:00"; take the date part.
    const end = new Date(String(endRaw).slice(0, 10));
    if (!Number.isNaN(end.getTime())) {
      return { stale: monthsBetween(end, now) > STALE_AFTER_MONTHS, label: end.getFullYear() };
    }
  }
  const year = data.latestAnnualYear ?? null;
  if (year !== null) {
    return { stale: year < now.getFullYear() - 2, label: year };
  }
  return { stale: false, label: null };
}

// Main entry point. `data` shape:
//   {
//     annualRevenues:        Number[]   // oldest → newest
//     ttmRevenue:            Number | null
//     annualFreeCashFlows:   Number[]   // oldest → newest
//     ttmFreeCashFlow:       Number | null
//   }
//
// Returns: { grade, criteria, score, reason? }
function gradeStock(data = {}, now = new Date()) {
  const annualRevenues = Array.isArray(data.annualRevenues) ? data.annualRevenues : [];
  const annualFreeCashFlows = Array.isArray(data.annualFreeCashFlows) ? data.annualFreeCashFlows : [];
  const ttmRevenue = data.ttmRevenue ?? null;
  const ttmFreeCashFlow = data.ttmFreeCashFlow ?? null;

  // Freshness guard: if the most recent annual report is more than ~2 years old,
  // the fundamentals likely belong to a defunct SEC filer — e.g. a ticker that
  // changed hands (Barrick took "B" from Barnes Group) or a company that
  // restructured — or Finnhub simply lacks recent filings. Either way grading
  // it would be misleading, so we return N/A instead of a confident-but-wrong
  // letter. Staleness is measured from the report's period-end date.
  const staleness = checkStale(data, now);
  if (staleness.stale) {
    return {
      grade: 'N/A',
      score: 0,
      criteria: [],
      reason: `Financial data looks outdated (most recent annual report is from ${staleness.label}); it may not match the current company.`
    };
  }

  // A company with revenue history but no usable free-cash-flow data almost
  // always reports no capital expenditure in the operating sense — i.e. it's a
  // bank, insurer, or other financial firm. Free cash flow simply doesn't apply,
  // so we explain that rather than pretending we're missing data.
  if (annualRevenues.length >= 2 && annualFreeCashFlows.length < 2) {
    return {
      grade: 'N/A',
      score: 0,
      criteria: [],
      reason: "Free cash flow can't be computed for this company (no capital-expenditure data). This is normal for banks, insurers, and other financial firms, which are better judged on sector-specific metrics."
    };
  }

  // Otherwise we genuinely lack enough history. Need at least 2 annual columns
  // for both revenue and FCF to evaluate long-term growth (criteria 1 and 4).
  if (annualRevenues.length < 2 || annualFreeCashFlows.length < 2) {
    return {
      grade: 'N/A',
      score: 0,
      criteria: [],
      reason: 'Not enough historical data to grade (need at least 2 annual columns of revenue and free cash flow).'
    };
  }

  const earliestRevenue = annualRevenues[0];
  const latestRevenue = annualRevenues[annualRevenues.length - 1];
  const earliestFcf = annualFreeCashFlows[0];
  const latestFcf = annualFreeCashFlows[annualFreeCashFlows.length - 1];

  const criteria = [
    buildCriterion(
      'Topline revenue growth (long-term)',
      latestRevenue,
      earliestRevenue,
      'income statement'
    ),
    buildCriterion(
      'Recent revenue growth (TTM)',
      ttmRevenue,
      latestRevenue,
      'income statement TTM'
    ),
    buildPositiveCriterion(
      'Net positive free cash flow',
      latestFcf,
      'cash flow statement'
    ),
    buildCriterion(
      'Free cash flow growth (long-term)',
      latestFcf,
      earliestFcf,
      'cash flow statement'
    ),
    buildCriterion(
      'Recent free cash flow growth (TTM)',
      ttmFreeCashFlow,
      latestFcf,
      'cash flow statement TTM'
    )
  ];

  // Count only the criteria that strictly passed. N/A counts as "no".
  const score = criteria.filter((c) => c.passed === true).length;
  const grade = GRADE_BY_SCORE[score];

  // For sectors where free cash flow is only a rough proxy, attach a caveat so
  // the grade is shown with the right context.
  const note = SECTOR_CAVEATS[data.industry] ?? null;

  return note ? { grade, score, criteria, note } : { grade, score, criteria };
}

module.exports = { gradeStock };
