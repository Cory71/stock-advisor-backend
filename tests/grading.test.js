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

  it('returns N/A when no data at all', () => {
    const result = gradeStock({});
    expect(result.grade).to.equal('N/A');
  });
});
