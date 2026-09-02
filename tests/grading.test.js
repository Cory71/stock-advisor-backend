// Unit tests for the pure grading function.
// Run with: npm test

const { expect } = require('chai');
const { gradeStock } = require('../lib/grading');

// A reusable "happy path" dataset: everything growing, everything positive.
// Should score 5/5 and earn an A.
const allYesData = {
  annualRevenues:      [100, 110, 120, 130],
  ttmRevenue:          140,
  annualFreeCashFlows: [10, 12, 14, 16],
  ttmFreeCashFlow:     18
};

describe('gradeStock — score → grade mapping', () => {
  it('returns A for 5 yeses', () => {
    const result = gradeStock(allYesData);
    expect(result.score).to.equal(5);
    expect(result.grade).to.equal('A');
  });

  it('returns B for 4 yeses', () => {
    // Break criterion 5 by making TTM FCF lower than latest annual FCF.
    const data = { ...allYesData, ttmFreeCashFlow: 15 };
    const result = gradeStock(data);
    expect(result.score).to.equal(4);
    expect(result.grade).to.equal('B');
  });

  it('returns C for 3 yeses', () => {
    // Break criteria 2 and 5 (both TTM growth checks).
    const data = { ...allYesData, ttmRevenue: 125, ttmFreeCashFlow: 15 };
    const result = gradeStock(data);
    expect(result.score).to.equal(3);
    expect(result.grade).to.equal('C');
  });

  it('returns D for 2 yeses', () => {
    // Break 2, 4, and 5 — keep long-term revenue growth + positive FCF.
    const data = {
      annualRevenues:      [100, 110, 120, 130],
      ttmRevenue:          125,
      annualFreeCashFlows: [16, 14, 12, 10],
      ttmFreeCashFlow:     9
    };
    const result = gradeStock(data);
    expect(result.score).to.equal(2);
    expect(result.grade).to.equal('D');
  });

  it('returns F for 0 yeses', () => {
    // Revenue shrinking, FCF negative throughout, TTM worse than annual.
    const data = {
      annualRevenues:      [130, 120, 110, 100],
      ttmRevenue:          90,
      annualFreeCashFlows: [-5, -8, -10, -12],
      ttmFreeCashFlow:     -15
    };
    const result = gradeStock(data);
    expect(result.score).to.equal(0);
    expect(result.grade).to.equal('F');
  });

  it('returns F for 1 yes', () => {
    // Only criterion 3 (positive FCF) passes.
    const data = {
      annualRevenues:      [130, 120, 110, 100],
      ttmRevenue:          90,
      annualFreeCashFlows: [20, 15, 10, 5],
      ttmFreeCashFlow:     3
    };
    const result = gradeStock(data);
    expect(result.score).to.equal(1);
    expect(result.grade).to.equal('F');
  });
});

describe('gradeStock — individual criteria', () => {
  it('marks criterion 3 (positive FCF) as passed when latest FCF > 0', () => {
    const result = gradeStock(allYesData);
    const fcfPositive = result.criteria.find((c) => c.name === 'Net positive free cash flow');
    expect(fcfPositive.passed).to.equal(true);
    expect(fcfPositive.value).to.equal(16);
  });

  it('marks criterion 3 as failed when latest FCF is negative', () => {
    const data = { ...allYesData, annualFreeCashFlows: [10, 12, 14, -5], ttmFreeCashFlow: -7 };
    const result = gradeStock(data);
    const fcfPositive = result.criteria.find((c) => c.name === 'Net positive free cash flow');
    expect(fcfPositive.passed).to.equal(false);
  });

  it('returns 5 criteria for a gradeable input', () => {
    const result = gradeStock(allYesData);
    expect(result.criteria).to.have.lengthOf(5);
  });

  it('treats missing TTM as N/A for criteria 2 and 5', () => {
    const data = { ...allYesData, ttmRevenue: null, ttmFreeCashFlow: null };
    const result = gradeStock(data);
    const ttmRev = result.criteria.find((c) => c.name === 'Recent revenue growth (TTM)');
    const ttmFcf = result.criteria.find((c) => c.name === 'Recent free cash flow growth (TTM)');
    expect(ttmRev.passed).to.equal(null);
    expect(ttmFcf.passed).to.equal(null);
    // Other three still pass → score 3 → grade C
    expect(result.score).to.equal(3);
    expect(result.grade).to.equal('C');
  });
});

describe('gradeStock — FCF-growth criteria require a positive latest value', () => {
  // Norwegian Cruise Line-style case: revenue growing, FCF improving but still
  // deeply negative. "Less negative" must not pass the FCF-growth checks.
  it('fails FCF-growth criteria 4 & 5 when FCF improved but is still negative', () => {
    const data = {
      annualRevenues:      [648, 5000, 9800, 9800],     // strong revenue growth
      ttmRevenue:          10000,
      annualFreeCashFlows: [-3200, -2500, -2000, -1200], // shrinking loss, still < 0
      ttmFreeCashFlow:     -949                           // still < 0
    };
    const result = gradeStock(data);
    const c4 = result.criteria.find((c) => c.name === 'Free cash flow growth (long-term)');
    const c5 = result.criteria.find((c) => c.name === 'Recent free cash flow growth (TTM)');
    expect(c4.passed).to.equal(false); // -1200 > -3200 but not > 0
    expect(c5.passed).to.equal(false); // -949 > -1200 but not > 0
    // Only the two revenue criteria pass -> score 2 -> D (not B)
    expect(result.score).to.equal(2);
    expect(result.grade).to.equal('D');
  });

  it('passes FCF-growth criteria when FCF grew AND is positive', () => {
    const data = {
      annualRevenues:      [100, 110, 120, 130],
      ttmRevenue:          140,
      annualFreeCashFlows: [-50, 10, 50, 100],  // crossed into positive and rising
      ttmFreeCashFlow:     120
    };
    const result = gradeStock(data);
    const c4 = result.criteria.find((c) => c.name === 'Free cash flow growth (long-term)');
    const c5 = result.criteria.find((c) => c.name === 'Recent free cash flow growth (TTM)');
    expect(c4.passed).to.equal(true);  // 100 > -50 and 100 > 0
    expect(c5.passed).to.equal(true);  // 120 > 100 and 120 > 0
    expect(result.grade).to.equal('A');
  });
});

describe('gradeStock — N/A handling', () => {
  it('returns N/A when fewer than 2 annual revenue columns', () => {
    const result = gradeStock({
      annualRevenues:      [100],
      ttmRevenue:          110,
      annualFreeCashFlows: [10, 12],
      ttmFreeCashFlow:     14
    });
    expect(result.grade).to.equal('N/A');
    expect(result.criteria).to.have.lengthOf(0);
    expect(result.reason).to.match(/historical data/i);
  });

  it('returns N/A when fewer than 2 annual FCF columns', () => {
    const result = gradeStock({
      annualRevenues:      [100, 110],
      ttmRevenue:          120,
      annualFreeCashFlows: [10],
      ttmFreeCashFlow:     12
    });
    expect(result.grade).to.equal('N/A');
  });

  it('explains FCF is not computable when revenue exists but FCF is absent', () => {
    const result = gradeStock({
      annualRevenues:      [100, 110, 120],
      ttmRevenue:          130,
      annualFreeCashFlows: [],   // no capex data we can read -> no FCF
      ttmFreeCashFlow:     null
    });
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.match(/free cash flow/i);
    expect(result.reason).to.match(/banks|insurers/i);
  });

  // This path is not only reached by financial firms. REITs (NNN), utilities
  // (NEE), and smaller filers land here too, because they tag capital spending
  // with a company-specific XBRL concept rather than a standard us-gaap one.
  // The wording must not tell those companies they are banks.
  it('does not claim the company is a financial firm', () => {
    const result = gradeStock({
      annualRevenues:      [100, 110, 120],
      ttmRevenue:          130,
      annualFreeCashFlows: [],
      ttmFreeCashFlow:     null
    });
    expect(result.reason).to.match(/REITs|utilities/i);
    expect(result.reason).not.to.match(/other financial firms/i);
  });

  it('uses the generic "not enough data" message when revenue history is too short', () => {
    const result = gradeStock({
      annualRevenues:      [100],   // only 1 year of revenue
      ttmRevenue:          110,
      annualFreeCashFlows: [],
      ttmFreeCashFlow:     null
    });
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.match(/historical data/i);
  });

  it('returns N/A when no data at all', () => {
    const result = gradeStock({});
    expect(result.grade).to.equal('N/A');
  });
});

describe('gradeStock — sector caveats', () => {
  it('attaches a REIT caveat when industry is Real Estate', () => {
    const result = gradeStock({ ...allYesData, industry: 'Real Estate' });
    expect(result.grade).to.equal('A');
    expect(result.note).to.match(/REIT|FFO/i);
  });

  it('attaches an insurance caveat when industry is Insurance', () => {
    const result = gradeStock({ ...allYesData, industry: 'Insurance' });
    expect(result.note).to.match(/insur/i);
  });

  it('attaches a utilities caveat when industry is Utilities', () => {
    const result = gradeStock({ ...allYesData, industry: 'Utilities' });
    expect(result.note).to.match(/utilit/i);
  });

  it('adds no note for an ordinary industry', () => {
    const result = gradeStock({ ...allYesData, industry: 'Technology' });
    expect(result.note).to.equal(undefined);
  });

  it('adds no note when industry is absent', () => {
    const result = gradeStock(allYesData);
    expect(result.note).to.equal(undefined);
  });
});

describe('gradeStock — stale data guard', () => {
  // Pass `now` explicitly so the tests don't depend on today's date.
  const now = new Date('2026-06-15');

  // --- date-based path (preferred): measures months from the period-end date ---
  it('returns N/A when the latest report ended well over 2 years ago', () => {
    const data = { ...allYesData, latestAnnualEndDate: '2015-12-31 00:00:00' };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.match(/outdated/i);
    expect(result.reason).to.include('2015');
  });

  it('grades normally when the latest report is recent', () => {
    const data = { ...allYesData, latestAnnualEndDate: '2025-12-31' };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('A');
  });

  it('allows data exactly 24 months old (boundary, inclusive)', () => {
    // 2024-06-30 -> 2026-06-15 is 24 whole months; cutoff is > 24, so it grades.
    const data = { ...allYesData, latestAnnualEndDate: '2024-06-30' };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('A');
  });

  it('returns N/A when data is more than 24 months old', () => {
    // 2024-05-31 -> 2026-06-15 is 25 months.
    const data = { ...allYesData, latestAnnualEndDate: '2024-05-31' };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('N/A');
  });

  it('catches off-calendar fiscal years (early-2024 end is stale by mid-2026)', () => {
    // A report labelled 2024 but ending Jan 2024 is ~29 months old — the
    // year-based check would have let this through; the date-based one flags it.
    const data = { ...allYesData, latestAnnualYear: 2024, latestAnnualEndDate: '2024-01-31' };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('N/A');
  });

  // --- year-based fallback path (when no end date is available) ---
  it('falls back to the report year when no end date is present', () => {
    const data = { ...allYesData, latestAnnualYear: 2015 };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.include('2015');
  });

  it('year fallback grades data within 2 years', () => {
    const data = { ...allYesData, latestAnnualYear: 2024 };
    const result = gradeStock(data, now);
    expect(result.grade).to.equal('A');
  });

  it('skips the guard when no year or end date is present (backward compatible)', () => {
    const result = gradeStock(allYesData, now);
    expect(result.grade).to.equal('A');
  });
});
