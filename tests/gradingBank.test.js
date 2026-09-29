// Unit tests for the bank grading model. Pure function, no database or network.

const { expect } = require('chai');
const { gradeBank } = require('../lib/gradingBank');

const B = 1_000_000_000;
const MEDIANS = { roe: 0.105, roa: 0.0100, efficiency: 0.607 };
const NOW = new Date('2026-09-29');

// A healthy JPMorgan-shaped bank: growing, ROE 15.7%, ROA 1.29%, efficiency 52%.
function strongBank(overrides = {}) {
  return {
    annualBankYears: [2021, 2022, 2023, 2024, 2025],
    annualEquity: [290 * B, 300 * B, 320 * B, 345 * B, 362 * B],
    annualNetIncome: [48 * B, 37 * B, 49 * B, 58 * B, 57 * B],
    annualAssets: [3700 * B, 3660 * B, 3870 * B, 4000 * B, 4424 * B],
    annualBankRevenue: [121 * B, 128 * B, 158 * B, 177 * B, 182 * B],
    annualNoninterestExpense: [71 * B, 76 * B, 87 * B, 92 * B, 95.6 * B],
    latestBankEndDate: '2025-12-31 00:00:00',
    ...overrides,
  };
}

// Replace just the latest year of one list.
function withLatest(list, value) {
  return [...list.slice(0, -1), value];
}

describe('gradeBank — overall', () => {
  it('grades a strong bank A on all five criteria', () => {
    const result = gradeBank(strongBank(), MEDIANS, NOW);
    expect(result.grade).to.equal('A');
    expect(result.criteria.map((c) => c.passed)).to.deep.equal([true, true, true, true, true]);
  });

  it('marks ratio criteria as percentages so the page prints them correctly', () => {
    const [, , roe, roa, eff] = gradeBank(strongBank(), MEDIANS, NOW).criteria;
    expect([roe.format, roa.format, eff.format]).to.deep.equal(['percent', 'percent', 'percent']);
    expect(roe.prior).to.equal(MEDIANS.roe);
  });

  it('returns N/A when no medians are supplied', () => {
    expect(gradeBank(strongBank(), null, NOW).grade).to.equal('N/A');
  });
});

describe('gradeBank — growth criteria', () => {
  it('fails book value growth when equity shrank', () => {
    const data = strongBank({ annualEquity: [362 * B, 350 * B, 340 * B, 330 * B, 320 * B] });
    expect(gradeBank(data, MEDIANS, NOW).criteria[0].passed).to.equal(false);
  });

  // A bank that went from a big loss to a smaller one still lost money.
  it('fails net income growth when the latest year is still a loss', () => {
    const data = strongBank({ annualNetIncome: [-9 * B, -8 * B, -6 * B, -4 * B, -2 * B] });
    expect(gradeBank(data, MEDIANS, NOW).criteria[1].passed).to.equal(false);
  });
});

describe('gradeBank — 5% tolerance band', () => {
  const assets = 1000 * B;

  // ROE is net income / equity. With equity 100B, net income sets ROE directly.
  function withRoe(roe) {
    return strongBank({
      annualEquity: withLatest(strongBank().annualEquity, 100 * B),
      annualNetIncome: withLatest(strongBank().annualNetIncome, roe * 100 * B),
      annualAssets: withLatest(strongBank().annualAssets, assets),
    });
  }

  it('passes ROE exactly on the median', () => {
    expect(gradeBank(withRoe(0.105), MEDIANS, NOW).criteria[2].passed).to.equal(true);
  });

  // 0.1 is 95.2% of 0.105 — inside the band.
  it('passes ROE just inside the band', () => {
    expect(gradeBank(withRoe(0.100), MEDIANS, NOW).criteria[2].passed).to.equal(true);
  });

  // 0.099 is 94.3% of 0.105 — clearly below the typical bank.
  it('fails ROE just outside the band', () => {
    expect(gradeBank(withRoe(0.099), MEDIANS, NOW).criteria[2].passed).to.equal(false);
  });

  // Efficiency: lower is better, so the band sits above the median (<= 63.7%).
  it('passes efficiency slightly worse than the median, fails when clearly worse', () => {
    const at = (eff) => strongBank({
      annualBankRevenue: withLatest(strongBank().annualBankRevenue, 100 * B),
      annualNoninterestExpense: withLatest(strongBank().annualNoninterestExpense, eff * 100 * B),
    });
    expect(gradeBank(at(0.63), MEDIANS, NOW).criteria[4].passed).to.equal(true);
    expect(gradeBank(at(0.65), MEDIANS, NOW).criteria[4].passed).to.equal(false);
  });
});

describe('gradeBank — N/A rules', () => {
  // State Street-shaped: net income unreadable, so ROE, ROA and net income
  // growth can't be judged. Must be N/A, not a fabricated F.
  it('returns N/A when two or more criteria are unreadable', () => {
    const data = strongBank({ annualNetIncome: [null, null, null, null, null] });
    const result = gradeBank(data, MEDIANS, NOW);
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.match(/could be read/i);
  });

  it('still grades with exactly one unreadable criterion, counting it as a no', () => {
    const data = strongBank({ annualBankRevenue: [null, null, null, null, null] });
    const result = gradeBank(data, MEDIANS, NOW);
    expect(result.grade).to.equal('B');
    expect(result.criteria[4].passed).to.equal(null);
  });

  it('returns N/A with fewer than two years of reports', () => {
    const data = strongBank({ annualBankYears: [2025], annualEquity: [362 * B], annualNetIncome: [57 * B] });
    expect(gradeBank(data, MEDIANS, NOW).grade).to.equal('N/A');
  });

  it('returns N/A when the latest report is more than two years old', () => {
    const data = strongBank({ latestBankEndDate: '2023-06-30 00:00:00' });
    const result = gradeBank(data, MEDIANS, NOW);
    expect(result.grade).to.equal('N/A');
    expect(result.reason).to.match(/outdated/i);
  });
});
