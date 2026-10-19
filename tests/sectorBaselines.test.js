// Tests for lib/sectorBaselines.js against an in-memory database: which
// stocks make up a pool, the industry backfill, and rebuilding baselines.

const { expect } = require('chai');
const { connect, disconnect, clearCollections } = require('./helpers/testDb');
const Stock = require('../models/Stock');
const SectorBaseline = require('../models/SectorBaseline');
const {
  refreshSectorBaselines, sectorContextFor, backfillIndustry,
} = require('../lib/sectorBaselines');

const RAW = {
  annualYears: [2021, 2025],
  annualRevenues: [100, 200],
  annualFcfYears: [2021, 2025],
  annualFreeCashFlows: [10, 40],
};

// Save a cached stock. `industry` goes in both places unless told otherwise.
function addStock(ticker, { industry = 'Technology', grade = 'B', model = 'general', rawData = RAW } = {}) {
  return Stock.create({
    ticker, grade, model, industry, criteria: [],
    rawData: { ...rawData, industry },
  });
}

// `count` Technology stocks, enough to clear the peer floor by default.
async function addTechPool(count = 8) {
  for (let i = 0; i < count; i++) await addStock(`T${i}`);
}

describe('sectorBaselines', () => {
  before(connect);
  after(disconnect);
  beforeEach(clearCollections);

  // Stocks cached before the field existed only have rawData.industry.
  it('copies industry out of rawData for older cached stocks', async () => {
    await Stock.collection.insertOne({
      ticker: 'OLD', grade: 'B', criteria: [], rawData: { industry: 'Media' },
    });
    expect(await backfillIndustry()).to.equal(1);
    expect((await Stock.findOne({ ticker: 'OLD' })).industry).to.equal('Media');
  });

  it('builds one baseline per industry', async () => {
    await addTechPool(3);
    await addStock('R1', { industry: 'Retail' });

    await refreshSectorBaselines();

    const tech = await SectorBaseline.findOne({ industry: 'Technology' });
    expect(tech.peerCount).to.equal(3);
    expect(tech.metrics.fcfMargin.median).to.equal(0.2);
    expect(await SectorBaseline.countDocuments()).to.equal(2);
  });

  // Banks are compared with banks inside their own grade, and N/A stocks have
  // no numbers worth comparing — neither belongs in a general-model pool.
  it('leaves banks and N/A stocks out of the pool', async () => {
    await addTechPool(2);
    await addStock('NA1', { grade: 'N/A' });
    await addStock('BNK', { model: 'bank' });

    await refreshSectorBaselines();

    expect((await SectorBaseline.findOne({ industry: 'Technology' })).peerCount).to.equal(2);
  });

  it('removes baselines for industries with no graded stocks left', async () => {
    await SectorBaseline.create({ industry: 'Gone', peerCount: 9, metrics: {}, computedAt: new Date() });
    await addTechPool(1);

    await refreshSectorBaselines();

    expect(await SectorBaseline.findOne({ industry: 'Gone' })).to.equal(null);
  });

  describe('sectorContextFor', () => {
    it('returns the comparison once the industry has enough peers', async () => {
      await addTechPool(8);
      await refreshSectorBaselines();

      const context = await sectorContextFor(await Stock.findOne({ ticker: 'T0' }));
      expect(context.industry).to.equal('Technology');
      expect(context.metrics[0]).to.include({ peers: 8, position: 'about' });
    });

    it('returns null for a thin industry', async () => {
      await addTechPool(7);
      await refreshSectorBaselines();
      expect(await sectorContextFor(await Stock.findOne({ ticker: 'T0' }))).to.equal(null);
    });

    it('returns null for a bank or an N/A stock', async () => {
      await addTechPool(8);
      await refreshSectorBaselines();
      expect(await sectorContextFor({ industry: 'Technology', model: 'bank', grade: 'B', rawData: RAW })).to.equal(null);
      expect(await sectorContextFor({ industry: 'Technology', model: 'general', grade: 'N/A', rawData: RAW })).to.equal(null);
    });
  });
});
