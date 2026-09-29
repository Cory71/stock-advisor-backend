// Tests for the bank medians calculation. Pure — no database.

const { expect } = require('chai');
const { computeBankMedians, median } = require('../lib/computeBankMedians');

// A cached bank whose latest-year ratios come out to the given values.
function bank(ticker, { roe, roa, efficiency }) {
  return {
    ticker,
    rawData: {
      annualNetIncome: [roe * 100],
      annualEquity: [100],
      annualAssets: [(roe * 100) / roa],
      annualNoninterestExpense: [efficiency * 100],
      annualBankRevenue: [100],
    },
  };
}

function pool(count) {
  return Array.from({ length: count }, (_, i) =>
    bank(`B${i}`, { roe: 0.08 + i * 0.005, roa: 0.008 + i * 0.0005, efficiency: 0.55 + i * 0.01 })
  );
}

describe('median', () => {
  it('takes the middle value of an odd count', () => {
    expect(median([3, 1, 2])).to.equal(2);
  });

  it('averages the middle two of an even count', () => {
    expect(median([1, 2, 3, 4])).to.equal(2.5);
  });
});

describe('computeBankMedians', () => {
  it('computes all three medians and records the pool', () => {
    const result = computeBankMedians(pool(9), new Date('2026-09-29'));
    expect(result.pool).to.have.lengthOf(9);
    expect(result.computedAt).to.equal('2026-09-29');
    expect(result.roe).to.equal(0.1);
    expect(result.efficiency).to.equal(0.59);
  });

  it('refuses to publish from fewer than 8 banks', () => {
    expect(() => computeBankMedians(pool(7))).to.throw(/need at least 8/);
  });

  // A bank missing a figure would drag a median around, so it's left out.
  it('leaves out banks missing a ratio', () => {
    const banks = [...pool(8), { ticker: 'HALF', rawData: { annualNetIncome: [5] } }];
    expect(computeBankMedians(banks).pool).to.not.include('HALF');
  });
});
