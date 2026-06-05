// API tests for /api/compare — 2 or 3 tickers/names, partial failures don't
// poison the whole response.

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');
const { installStubs, restore, DEFAULT_STOCK_DATA } = require('../helpers/mockYahoo');
const { createUserAndToken } = require('../helpers/authToken');

describe('GET /api/compare', () => {
  let token;

  before(connect);
  after(disconnect);

  beforeEach(async () => {
    await clearCollections();
    ({ token } = await createUserAndToken());
  });
  afterEach(restore);

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/compare?tickers=AAPL,MSFT');
    expect(res.status).to.equal(401);
  });

  it('rejects requests with fewer than 2 tickers', async () => {
    installStubs();
    const res = await request(app)
      .get('/api/compare?tickers=AAPL')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).to.equal(400);
  });

  it('rejects requests with more than 3 tickers', async () => {
    installStubs();
    const res = await request(app)
      .get('/api/compare?tickers=A,B,C,D')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).to.equal(400);
  });

  it('returns graded results for 3 tickers in parallel', async () => {
    installStubs();

    const res = await request(app)
      .get('/api/compare?tickers=AAPL,MSFT,GOOG')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.lengthOf(3);
    for (const row of res.body) {
      expect(row.grade).to.match(/^[A-F]$/);
      expect(row).to.have.property('price');
      expect(row).to.have.property('currency');
    }
  });

  it('reports per-ticker errors without breaking the whole response', async () => {
    // Match by argument, not call order — the route fires all 3 lookups in
    // parallel via Promise.allSettled, so call order is non-deterministic.
    // AAPL + MSFT succeed; NOPE throws and the search fallback returns null,
    // so NOPE ends up as the single errored row in the response.
    const yahoo = require('../../providers/yahooProvider');
    const dataStub = sinon.stub(yahoo, 'getStockData');
    dataStub.withArgs('AAPL').resolves(DEFAULT_STOCK_DATA);
    dataStub.withArgs('MSFT').resolves(DEFAULT_STOCK_DATA);
    dataStub.withArgs('NOPE').rejects(new Error('Yahoo: not found'));
    sinon.stub(yahoo, 'resolveTicker').resolves(null);

    const res = await request(app)
      .get('/api/compare?tickers=AAPL,MSFT,NOPE')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.lengthOf(3);
    const errored = res.body.find((r) => r.error);
    expect(errored).to.exist;
    expect(errored.ticker).to.equal('NOPE');
    const successes = res.body.filter((r) => !r.error);
    expect(successes).to.have.lengthOf(2);
  });
});
