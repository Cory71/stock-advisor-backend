// Pure bank-grading function. Banks have no capital expenditure in the usual
// sense, so free cash flow doesn't apply and the general model returns N/A for
// them. This model judges them on the figures banks are actually measured by.
//
// The 5 criteria (each yes/no):
//   1. Book value growth   — latest equity > earliest equity in the window
//   2. Net income growth   — latest net income > earliest, and still a profit
//   3. Return on equity    — not clearly below the typical bank
//   4. Return on assets    — not clearly below the typical bank
//   5. Efficiency ratio    — not clearly worse than the typical bank (lower is better)
//
// "Typical bank" means the median of the bank pool, stored in
// lib/bankMedians.json and passed in by the caller, so this function stays pure
// and never reads from disk.
//
// Why a tolerance band instead of a strict "above the median": banks cluster
// tightly, so four of the fourteen sit within 0.02 percentage points of the ROA
// median. A strict line would pass or fail them on noise. With a 5% band a ratio
// passes unless it is *clearly* worse than the typical bank.
//
// Score -> grade: 5=A, 4=B, 3=C, 2=D, 0-1=F — the same scale as the general model.

const { GRADE_BY_SCORE, buildCriterion, checkStale } = require('./grading');

const TOLERANCE = 0.05;

// Two or more unreadable criteria means we'd be grading on too little — return
// N/A rather than a low letter that really reflects missing data.
const MAX_UNREADABLE_CRITERIA = 1;

// ---------- Small helpers ----------

// numerator / denominator, or null if it can't be worked out safely.
function ratio(numerator, denominator) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

// Last item of a list, or null.
function latest(list) {
  return list.length ? list[list.length - 1] : null;
}

// A bank's three ratios from its latest year. Shared with the medians script,
// so the medians are always worked out exactly the way they're compared.
function bankRatios(data) {
  const netIncome = latest(data.annualNetIncome || []);
  return {
    roe: ratio(netIncome, latest(data.annualEquity || [])),
    roa: ratio(netIncome, latest(data.annualAssets || [])),
    efficiency: ratio(latest(data.annualNoninterestExpense || []), latest(data.annualBankRevenue || [])),
  };
}

// One ratio criterion. `higherIsBetter` decides which side of the band passes.
function buildRatioCriterion(name, value, median, higherIsBetter) {
  const base = { name, value, prior: median, source: 'bank median', format: 'percent' };
  if (value == null || median == null) return { ...base, passed: null };

  const passed = higherIsBetter
    ? value >= median * (1 - TOLERANCE)
    : value <= median * (1 + TOLERANCE);
  return { ...base, passed };
}

// An N/A result with a plain-English reason.
function notApplicable(reason) {
  return { grade: 'N/A', score: 0, criteria: [], reason };
}

// ---------- Main entry point ----------

// `data` is getStockData's result for a bank (annualBankYears, annualEquity, …).
// `medians` is { roe, roa, efficiency } from lib/bankMedians.json.
function gradeBank(data = {}, medians = null, now = new Date()) {
  const years = data.annualBankYears || [];
  const equity = data.annualEquity || [];
  const netIncome = data.annualNetIncome || [];

  if (!medians) {
    return notApplicable('Bank grading is not available right now.');
  }

  // Freshness uses the bank figures' own dates — the general parser may have
  // found no years at all for a bank with no revenue line.
  const staleness = checkStale(
    { latestAnnualEndDate: data.latestBankEndDate, latestAnnualYear: latest(years) },
    now
  );
  if (staleness.stale) {
    return notApplicable(
      `Financial data looks outdated (most recent annual report is from ${staleness.label}); it may not match the current company.`
    );
  }

  if (years.length < 2) {
    return notApplicable('Not enough historical data to grade (need at least 2 annual reports).');
  }

  const ratios = bankRatios(data);

  const criteria = [
    buildCriterion('Book value growth (long-term)', latest(equity), equity[0], 'balance sheet'),
    // Must still be a profit: shrinking a loss isn't healthy earnings growth.
    buildCriterion('Net income growth (long-term)', latest(netIncome), netIncome[0], 'income statement', true),
    buildRatioCriterion('Return on equity', ratios.roe, medians.roe, true),
    buildRatioCriterion('Return on assets', ratios.roa, medians.roa, true),
    buildRatioCriterion('Efficiency ratio (lower is better)', ratios.efficiency, medians.efficiency, false),
  ];

  const unreadable = criteria.filter((c) => c.passed === null).length;
  if (unreadable > MAX_UNREADABLE_CRITERIA) {
    return notApplicable(
      "Too few of this bank's figures could be read from its filings to grade it fairly."
    );
  }

  const score = criteria.filter((c) => c.passed === true).length;
  return { grade: GRADE_BY_SCORE[score], score, criteria };
}

module.exports = { gradeBank, bankRatios, TOLERANCE };
