// Pure stock-grading function. Takes financial data, returns an A-F grade
// plus a breakdown of the 5 criteria. No I/O, no side effects — easy to test.
//
// The 5 criteria (each yes/no, sourced from Yahoo Finance):
//   1. Topline revenue growth (long-term)   — latest annual revenue > earliest annual revenue
//   2. Recent revenue growth (TTM)          — TTM revenue > most recent annual revenue
//   3. Net positive free cash flow          — most recent FCF > 0
//   4. Free cash flow growth (long-term)    — latest annual FCF > earliest annual FCF
//   5. Recent free cash flow growth (TTM)   — TTM FCF > most recent annual FCF
//
// Score → grade mapping: 5=A, 4=B, 3=C, 2=D, 0–1=F.

// Map a count of yeses (0–5) to a letter grade.
const GRADE_BY_SCORE = ['F', 'F', 'D', 'C', 'B', 'A'];

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

// Main entry point. `data` shape:
//   {
//     annualRevenues:        Number[]   // oldest → newest
//     ttmRevenue:            Number | null
//     annualFreeCashFlows:   Number[]   // oldest → newest
//     ttmFreeCashFlow:       Number | null
//   }
//
// Returns: { grade, criteria, score, reason? }
function gradeStock(data = {}, currentYear = new Date().getFullYear()) {
  const annualRevenues = Array.isArray(data.annualRevenues) ? data.annualRevenues : [];
  const annualFreeCashFlows = Array.isArray(data.annualFreeCashFlows) ? data.annualFreeCashFlows : [];
  const ttmRevenue = data.ttmRevenue ?? null;
  const ttmFreeCashFlow = data.ttmFreeCashFlow ?? null;
  const latestAnnualYear = data.latestAnnualYear ?? null;

  // Freshness guard: if the most recent annual report is more than 2 years old,
  // the fundamentals likely belong to a defunct SEC filer — e.g. a ticker that
  // changed hands (Barrick took "B" from Barnes Group) or a company that
  // restructured. Grading that data would describe the wrong company, so we
  // return N/A instead of a confident-but-wrong letter.
  if (latestAnnualYear !== null && latestAnnualYear < currentYear - 2) {
    return {
      grade: 'N/A',
      score: 0,
      criteria: [],
      reason: `Financial data looks outdated (most recent annual report is from ${latestAnnualYear}); it may not match the current company.`
    };
  }

  // Need at least 2 annual columns for both revenue and FCF, otherwise we can't
  // meaningfully evaluate long-term growth (criteria 1 and 4).
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

  return { grade, score, criteria };
}

module.exports = { gradeStock };
