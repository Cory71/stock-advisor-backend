// API tests for /api/grade/:query — covers ticker lookup, name resolution,
// cache hit/miss, and the "looks like a ticker but isn't" fallback.

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');
const { installStubs, restore, DEFAULT_STOCK_DATA } = require('../helpers/mockProvider');
const { createUserAndToken } = require('../helpers/authToken');
const Stock = require('../../models/Stock');
const SearchHistory = require('../../models/SearchHistory');

describe('GET /api/grade/:query', () => {
  let token;

  before(connect);
  after(disconnect);

  beforeEach(async () => {
    await clearCollections();
    ({ token } = await createUserAndToken());
  });
  afterEach(restore);

  it('rejects requests without a JWT', async () => {
    const res = await request(app).get('/api/grade/AAPL');
    expect(res.status).to.equal(401);
  });

  it('grades a real ticker on cache miss, then caches the result', async () => {
    installStubs();

    const res = await request(app)
      .get('/api/grade/AAPL')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.include({ ticker: 'AAPL', name: 'Apple Inc.', cached: false });
    expect(res.body.grade).to.match(/^[A-F]$/);
    expect(res.body.price).to.equal(310.61);
    expect(res.body.currency).to.equal('USD');

    const cached = await Stock.findOne({ ticker: 'AAPL' });
    expect(cached).to.exist;
    expect(cached.grade).to.equal(res.body.grade);
  });

  it('returns the cached result on the second lookup', async () => {
    installStubs();

    // First call writes to the cache.
    await request(app).get('/api/grade/AAPL').set('Authorization', `Bearer ${token}`);

    // Second call should hit the cache and report cached:true.
    const res = await request(app)
      .get('/api/grade/AAPL')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.cached).to.equal(true);
  });

  it('bypasses the cache and re-fetches when ?refresh=1 is passed', async () => {
    const { stockDataStub } = installStubs();

    // First call writes to the cache.
    await request(app).get('/api/grade/AAPL').set('Authorization', `Bearer ${token}`);

    // A forced refresh should skip the cache, call the provider again, and
    // report cached:false so the timestamp updates.
    const res = await request(app)
      .get('/api/grade/AAPL?refresh=1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.cached).to.equal(false);
    expect(stockDataStub.callCount).to.equal(2); // once per request, no cache short-circuit
  });

  it('resolves a company name to the canonical ticker', async () => {
    installStubs({
      resolved: { symbol: 'MSFT', name: 'Microsoft Corporation' },
      stockData: { ...DEFAULT_STOCK_DATA, longName: 'Microsoft Corporation' }
    });

    const res = await request(app)
      .get('/api/grade/Microsoft')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.ticker).to.equal('MSFT');
    expect(res.body.name).to.equal('Microsoft Corporation');
  });

  it('uses the search fallback when input looks like a ticker but the provider doesn\'t know it', async () => {
    // First getStockData call (with "APPLE") fails; resolveTicker returns AAPL;
    // second getStockData call (with "AAPL") succeeds with the default data.
    const sinon = require('sinon');
    const provider = require('../../providers/finnhubProvider');

    const dataStub = sinon.stub(provider, 'getStockData');
    dataStub.onFirstCall().rejects(new Error('not found'));
    dataStub.onSecondCall().resolves(DEFAULT_STOCK_DATA);
    sinon.stub(provider, 'resolveTicker').resolves({ symbol: 'AAPL', name: 'Apple Inc.' });

    const res = await request(app)
      .get('/api/grade/APPLE')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.ticker).to.equal('AAPL');
  });

  it('records the canonical ticker in search history', async () => {
    installStubs({ resolved: { symbol: 'MSFT', name: 'Microsoft Corporation' } });

    await request(app).get('/api/grade/Microsoft').set('Authorization', `Bearer ${token}`);

    const history = await SearchHistory.find({});
    expect(history).to.have.lengthOf(1);
    expect(history[0].ticker).to.equal('MSFT');
  });

  it('returns 404 when nothing resolves', async () => {
    installStubs({ resolvedNull: true });

    const res = await request(app)
      .get('/api/grade/nonsense123')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(404);
    expect(res.body.message).to.match(/couldn't find/i);
  });

  it('returns 503 with a friendly message when the provider blows up unexpectedly', async () => {
    // Both provider calls throw, so the outer try/catch fires the 503 path.
    const sinon = require('sinon');
    const provider = require('../../providers/finnhubProvider');
    sinon.stub(provider, 'getStockData').rejects(new Error('connect ETIMEDOUT'));
    sinon.stub(provider, 'resolveTicker').rejects(new Error('connect ETIMEDOUT'));

    const res = await request(app)
      .get('/api/grade/Microsoft')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(503);
    expect(res.body.message).to.match(/temporarily unavailable/i);
  });

  it('returns a friendly "U.S.-listed only" message when Finnhub denies access (403)', async () => {
    // A non-US symbol (e.g. a Toronto ".TO" listing) gets 403 from Finnhub.
    const sinon = require('sinon');
    const provider = require('../../providers/finnhubProvider');
    const denied = new Error('Finnhub returned 403 for /quote');
    denied.status = 403;
    sinon.stub(provider, 'getStockData').rejects(denied);
    const resolveStub = sinon.stub(provider, 'resolveTicker').resolves(null);

    const res = await request(app)
      .get('/api/grade/SHOP.TO')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(404);
    expect(res.body.message).to.match(/U\.S\.-listed/i);
    expect(res.body.message).to.include('SHOP.TO');
    // The 403 short-circuits before the search fallback runs.
    expect(resolveStub.called).to.equal(false);
  });
});
