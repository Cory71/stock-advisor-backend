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

  // Found on the first CI run: IEC.AQ was the only stale stock, Finnhub
  // refused it, and the whole run was flagged as an outage.
  it('reports a listing Finnhub refuses as skipped, not failed', async () => {
    await cacheStock('IEC.AQ');
    const refused = Object.assign(new Error('Finnhub returned 403'), { status: 403 });
    sinon.stub(finnhubProvider, 'getStockData').rejects(refused);

    const summary = await refreshCache({ delayMs: 0 });

    expect(summary.skipped).to.deep.equal(['IEC.AQ']);
    expect(summary.failed).to.deep.equal([]);
  });

  it('does nothing when the cache is empty', async () => {
    const summary = await refreshCache({ delayMs: 0 });
    expect(summary).to.deep.equal({ checked: 0, refreshed: 0, skipped: [], failed: [], gradeChanges: [] });
  });
});

// --- Explaining a grade change ------------------------------------------
// On 7-9 October 2026 grades flipped for three days and the log only held
// letters. These check that a change now says which criteria moved and
// whether the quarterly report behind the TTM figures changed.
const { describeChange } = require('../lib/refreshCache');

describe('describeChange', () => {
  const criteria = (recentRevenue, recentFcf) => [
    { name: 'Topline revenue growth (long-term)', passed: true },
    { name: 'Recent revenue growth (TTM)', passed: recentRevenue },
    { name: 'Net positive free cash flow', passed: true },
    { name: 'Free cash flow growth (long-term)', passed: true },
    { name: 'Recent free cash flow growth (TTM)', passed: recentFcf },
  ];

  // NVIDIA went A -> C on 7 October: both TTM criteria dropped together.
  it('names the criteria that changed and the TTM quarter that moved', () => {
    const before = { ticker: 'NVDA', grade: 'A', criteria: criteria(true, true), rawData: { ttmQuarter: '2027Q2' } };
    const saved = { grade: 'C', criteria: criteria(null, null), rawData: { ttmQuarter: '2027Q1' } };

    const change = describeChange(before, saved);

    expect(change).to.include({ ticker: 'NVDA', from: 'A', to: 'C' });
    expect(change.criteria).to.deep.equal([
      'Recent revenue growth (TTM): pass -> n/a',
      'Recent free cash flow growth (TTM): pass -> n/a',
    ]);
    expect(change.ttmQuarter).to.deep.equal({ from: '2027Q2', to: '2027Q1' });
  });

  it('leaves the TTM quarter out when it did not change', () => {
    const before = { ticker: 'V', grade: 'A', criteria: criteria(true, true), rawData: { ttmQuarter: '2026Q3' } };
    const saved = { grade: 'B', criteria: criteria(true, false), rawData: { ttmQuarter: '2026Q3' } };

    const change = describeChange(before, saved);

    expect(change.criteria).to.deep.equal(['Recent free cash flow growth (TTM): pass -> fail']);
    expect(change.ttmQuarter).to.equal(null);
  });

  // Stocks cached before this change have no ttmQuarter recorded yet.
  it('copes with an older cached stock that has no TTM quarter recorded', () => {
    const before = { ticker: 'MDB', grade: 'C', criteria: criteria(null, null), rawData: {} };
    const saved = { grade: 'A', criteria: criteria(true, true), rawData: { ttmQuarter: '2027Q2' } };

    expect(describeChange(before, saved).ttmQuarter).to.deep.equal({ from: null, to: '2027Q2' });
  });
});
