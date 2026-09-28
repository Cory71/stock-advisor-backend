// Tests for the scheduled cache refresh. Uses the in-memory database and the
// stubbed provider, so no real Finnhub calls and no waiting between tickers.

const { expect } = require('chai');
const sinon = require('sinon');
const { connect, disconnect, clearCollections } = require('./helpers/testDb');
const { DEFAULT_STOCK_DATA } = require('./helpers/mockProvider');
const finnhubProvider = require('../providers/finnhubProvider');
const Stock = require('../models/Stock');
const { refreshCache } = require('../lib/refreshCache');

const HOUR = 60 * 60 * 1000;

// Insert a cached stock, then backdate it so it counts as stale (or fresh).
async function cacheStock(ticker, { grade = 'C', ageHours = 48 } = {}) {
  await Stock.create({ ticker, grade, criteria: [], rawData: {} });
  const updatedAt = new Date(Date.now() - ageHours * HOUR);
  // timestamps: false stops Mongoose from overwriting the backdated time.
  await Stock.updateOne({ ticker }, { $set: { updatedAt } }, { timestamps: false });
}

describe('refreshCache', () => {
  before(connect);
  after(disconnect);
  beforeEach(clearCollections);
  afterEach(() => sinon.restore());

  it('re-grades stale stocks and saves the new grade', async () => {
    await cacheStock('AAPL', { grade: 'F' });
    sinon.stub(finnhubProvider, 'getStockData').resolves(DEFAULT_STOCK_DATA);

    const summary = await refreshCache({ delayMs: 0 });

    expect(summary).to.include({ checked: 1, refreshed: 1 });
    const saved = await Stock.findOne({ ticker: 'AAPL' });
    expect(saved.grade).to.not.equal('F');
    expect(saved.price).to.equal(DEFAULT_STOCK_DATA.price);
  });

  it('reports grades that changed', async () => {
    await cacheStock('AAPL', { grade: 'F' });
    sinon.stub(finnhubProvider, 'getStockData').resolves(DEFAULT_STOCK_DATA);

    const summary = await refreshCache({ delayMs: 0 });

    expect(summary.gradeChanges).to.have.lengthOf(1);
    expect(summary.gradeChanges[0]).to.include({ ticker: 'AAPL', from: 'F' });
  });

  // A user who clicked Refresh an hour ago shouldn't cost another 4 API calls.
  it('skips stocks graded recently', async () => {
    await cacheStock('AAPL', { ageHours: 1 });
    const stub = sinon.stub(finnhubProvider, 'getStockData').resolves(DEFAULT_STOCK_DATA);

    const summary = await refreshCache({ delayMs: 0 });

    expect(summary.checked).to.equal(0);
    expect(stub.called).to.equal(false);
  });

  it('keeps going when one ticker fails', async () => {
    await cacheStock('AAPL');
    await cacheStock('BAD');
    await cacheStock('MSFT');
    const stub = sinon.stub(finnhubProvider, 'getStockData');
    stub.withArgs('BAD').rejects(new Error('Finnhub returned 500'));
    stub.resolves(DEFAULT_STOCK_DATA);

    const summary = await refreshCache({ delayMs: 0 });

    expect(summary).to.include({ checked: 3, refreshed: 2 });
    expect(summary.failed).to.deep.equal([{ ticker: 'BAD', error: 'Finnhub returned 500' }]);
  });

  it('leaves a failed ticker\'s cached grade untouched', async () => {
    await cacheStock('BAD', { grade: 'B' });
    sinon.stub(finnhubProvider, 'getStockData').rejects(new Error('timeout'));

    await refreshCache({ delayMs: 0 });

    const saved = await Stock.findOne({ ticker: 'BAD' });
    expect(saved.grade).to.equal('B');
  });

  it('does nothing when the cache is empty', async () => {
    const summary = await refreshCache({ delayMs: 0 });
    expect(summary).to.deep.equal({ checked: 0, refreshed: 0, failed: [], gradeChanges: [] });
  });
});
