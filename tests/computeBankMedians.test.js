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

describe('mediansChanged', () => {
  const { mediansChanged } = require('../lib/computeBankMedians');
  const base = { computedAt: '2026-04-15', pool: ['A', 'B'], roe: 0.105, roa: 0.01, efficiency: 0.607 };

  // The file carries the date, so a same-values run must not count as a change
  // — otherwise the yearly job would commit every time.
  it('ignores a new date when the medians and pool are the same', () => {
    expect(mediansChanged(base, { ...base, computedAt: '2027-04-15' })).to.equal(false);
  });

  it('notices a changed median or pool', () => {
    expect(mediansChanged(base, { ...base, roe: 0.11 })).to.equal(true);
    expect(mediansChanged(base, { ...base, pool: ['A', 'B', 'C'] })).to.equal(true);
  });

  it('treats a first run as a change', () => {
    expect(mediansChanged(null, base)).to.equal(true);
  });
});

describe('suspiciousShifts', () => {
  const { suspiciousShifts } = require('../lib/computeBankMedians');
  const before = { roe: 0.10, roa: 0.01, efficiency: 0.60 };

  it('allows an ordinary year-on-year move', () => {
    expect(suspiciousShifts(before, { roe: 0.11, roa: 0.0105, efficiency: 0.58 })).to.deep.equal([]);
  });

  // A jump like this means a mis-read filing or a half-seeded cache.
  it('flags a median that moved more than 25%', () => {
    const problems = suspiciousShifts(before, { roe: 0.14, roa: 0.01, efficiency: 0.60 });
    expect(problems).to.have.lengthOf(1);
    expect(problems[0]).to.match(/^roe moved 40%/);
  });

  it('has nothing to compare on the first run', () => {
    expect(suspiciousShifts(null, before)).to.deep.equal([]);
  });
});
