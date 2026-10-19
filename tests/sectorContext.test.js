// Tests for lib/sectorContext.js — the metrics, the per-industry baselines,
// and the comparison shown on the grade page.

const { expect } = require('chai');
const {
  stockMetrics, yearlyGrowth, computeBaselines, buildSectorContext, MIN_PEERS,
} = require('../lib/sectorContext');

// A stock whose revenue doubles over 4 years (about 18.9% a year) with free
// cash flow of 20% of revenue in the latest year.
function rawData(overrides = {}) {
  return {
    annualYears: [2021, 2022, 2023, 2024, 2025],
    annualRevenues: [100, 120, 140, 170, 200],
    annualFcfYears: [2021, 2022, 2023, 2024, 2025],
    annualFreeCashFlows: [10, 15, 20, 30, 40],
    ...overrides,
  };
}

// A baseline where every metric has `peers` stocks behind it.
function baseline(peers = 10, medians = { revenueCagr: 0.1, fcfMargin: 0.15, fcfCagr: 0.1 }) {
  return {
    industry: 'Technology',
    peerCount: peers,
    metrics: {
      revenueCagr: { median: medians.revenueCagr, peers },
      fcfMargin: { median: medians.fcfMargin, peers },
      fcfCagr: { median: medians.fcfCagr, peers },
    },
  };
}

describe('sectorContext', () => {
  describe('yearlyGrowth', () => {
    it('works out compound growth per year', () => {
      expect(yearlyGrowth([100, 200], [2021, 2025])).to.be.closeTo(0.1892, 0.0001);
    });

    // A missing year (e.g. no 2023 report) must not shorten the span.
    it('uses the real span of years, not the number of values', () => {
      expect(yearlyGrowth([100, 121], [2022, 2024])).to.be.closeTo(0.1, 0.0001);
    });

    it('is null when growth starts or ends at a loss', () => {
      expect(yearlyGrowth([-10, 50], [2021, 2025])).to.equal(null);
      expect(yearlyGrowth([10, -5], [2021, 2025])).to.equal(null);
    });

    it('is null with fewer than two values or mismatched years', () => {
      expect(yearlyGrowth([100], [2025])).to.equal(null);
      expect(yearlyGrowth([100, 200], [2025])).to.equal(null);
    });
  });

  describe('stockMetrics', () => {
    it('returns all three metrics', () => {
      const m = stockMetrics(rawData());
      expect(m.revenueCagr).to.be.closeTo(0.1892, 0.0001);
      expect(m.fcfMargin).to.equal(0.2);
      expect(m.fcfCagr).to.be.closeTo(0.4142, 0.0001);
    });

    // FCF can cover different years than revenue; the margin must pair the
    // latest FCF with revenue from that same year.
    it('pairs free cash flow with revenue from the same year', () => {
      const m = stockMetrics(rawData({ annualFcfYears: [2021, 2024], annualFreeCashFlows: [10, 34] }));
      expect(m.fcfMargin).to.equal(0.2); // 34 / 170, the 2024 revenue
    });

    it('returns nulls rather than throwing on empty data', () => {
      expect(stockMetrics({})).to.deep.equal({ revenueCagr: null, fcfMargin: null, fcfCagr: null });
    });
  });

  describe('computeBaselines', () => {
    it('groups stocks by industry and takes each metric median', () => {
      const stocks = [
        { industry: 'Retail', rawData: rawData({ annualFreeCashFlows: [10, 15, 20, 30, 10] }) },  // 5%
        { industry: 'Retail', rawData: rawData({ annualFreeCashFlows: [10, 15, 20, 30, 20] }) },  // 10%
        { industry: 'Retail', rawData: rawData({ annualFreeCashFlows: [10, 15, 20, 30, 60] }) },  // 30%
        { industry: 'Media', rawData: rawData() },
      ];
      const [retail, media] = computeBaselines(stocks);
      expect(retail.industry).to.equal('Retail');
      expect(retail.peerCount).to.equal(3);
      expect(retail.metrics.fcfMargin).to.deep.equal({ median: 0.1, peers: 3 });
      expect(media.peerCount).to.equal(1);
    });

    // A stock whose FCF growth can't be worked out still counts towards the
    // other metrics — each metric keeps its own peer count.
    it('counts peers per metric', () => {
      const stocks = [
        { industry: 'Retail', rawData: rawData() },
        { industry: 'Retail', rawData: rawData({ annualFreeCashFlows: [-5, 15, 20, 30, 40] }) },
      ];
      const [retail] = computeBaselines(stocks);
      expect(retail.metrics.revenueCagr.peers).to.equal(2);
      expect(retail.metrics.fcfCagr.peers).to.equal(1);
    });

    // GOOG and GOOGL are one company; it must only count once.
    it('counts a company with two share classes once', () => {
      const stocks = [
        { ticker: 'GOOG', name: 'Alphabet Inc', industry: 'Media', rawData: rawData() },
        { ticker: 'GOOGL', name: 'Alphabet Inc', industry: 'Media', rawData: rawData() },
        { ticker: 'META', name: 'Meta Platforms Inc', industry: 'Media', rawData: rawData() },
      ];
      expect(computeBaselines(stocks)[0].peerCount).to.equal(2);
    });

    it('skips stocks with no industry', () => {
      expect(computeBaselines([{ industry: null, rawData: rawData() }])).to.deep.equal([]);
    });
  });

  describe('buildSectorContext', () => {
    it('says above, about or below the median for each metric', () => {
      const context = buildSectorContext(
        rawData(),
        baseline(10, { revenueCagr: 0.1, fcfMargin: 0.195, fcfCagr: 0.6 })
      );
      expect(context.industry).to.equal('Technology');
      expect(context.metrics.map((m) => m.position)).to.deep.equal(['above', 'about', 'below']);
      expect(context.metrics[0]).to.include({ key: 'revenueCagr', median: 0.1, peers: 10 });
    });

    it(`shows nothing below ${MIN_PEERS} peers`, () => {
      expect(buildSectorContext(rawData(), baseline(MIN_PEERS - 1))).to.equal(null);
      expect(buildSectorContext(rawData(), baseline(MIN_PEERS))).to.not.equal(null);
    });

    // Only the metrics that clear the bar are shown; the rest are left out.
    it('drops just the metrics with too few peers', () => {
      const thin = baseline(10);
      thin.metrics.fcfCagr.peers = 3;
      const context = buildSectorContext(rawData(), thin);
      expect(context.metrics.map((m) => m.key)).to.deep.equal(['revenueCagr', 'fcfMargin']);
    });

    it('leaves out a metric the stock itself is missing', () => {
      const context = buildSectorContext(
        rawData({ annualFreeCashFlows: [-5, 15, 20, 30, 40] }),
        baseline(10)
      );
      expect(context.metrics.map((m) => m.key)).to.not.include('fcfCagr');
    });

    it('is null with no baseline', () => {
      expect(buildSectorContext(rawData(), null)).to.equal(null);
    });
  });
});
