// API tests for /api/history — last 20 lookups, enriched with company name
// from the Stock cache.

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');
const { createUserAndToken } = require('../helpers/authToken');
const Stock = require('../../models/Stock');
const SearchHistory = require('../../models/SearchHistory');

describe('GET /api/history', () => {
  let token;
  let userId;

  before(connect);
  after(disconnect);

  beforeEach(async () => {
    await clearCollections();
    const created = await createUserAndToken();
    token = created.token;
    userId = created.user._id;
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).to.equal(401);
  });

  it('returns an empty list when the user has no history', async () => {
    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.be.an('array').that.is.empty;
  });

  it('returns history rows newest-first with company name attached', async () => {
    // Seed the Stock cache so the enrichment has something to find.
    await Stock.create({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      grade: 'B',
      criteria: []
    });
    await Stock.create({
      ticker: 'MSFT',
      name: 'Microsoft Corporation',
      grade: 'A',
      criteria: []
    });

    // Older lookup first, then a newer one.
    await SearchHistory.create({ userId, ticker: 'AAPL' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await SearchHistory.create({ userId, ticker: 'MSFT' });

    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.lengthOf(2);
    expect(res.body[0].ticker).to.equal('MSFT');
    expect(res.body[0].name).to.equal('Microsoft Corporation');
    expect(res.body[1].ticker).to.equal('AAPL');
    expect(res.body[1].name).to.equal('Apple Inc.');
  });

  it('returns name=null for tickers that aren\'t in the Stock cache', async () => {
    await SearchHistory.create({ userId, ticker: 'XYZQ' });

    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.lengthOf(1);
    expect(res.body[0].ticker).to.equal('XYZQ');
    expect(res.body[0].name).to.equal(null);
  });

  it('caps the result at 20 rows', async () => {
    const docs = [];
    for (let i = 0; i < 25; i++) {
      docs.push({ userId, ticker: `T${i}` });
    }
    await SearchHistory.insertMany(docs);

    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.lengthOf(20);
  });
});
