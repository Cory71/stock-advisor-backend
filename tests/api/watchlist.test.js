// API tests for /api/watchlist — GET, POST (with gradeAtAdd snapshot), DELETE.

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');
const { installStubs, restore, DEFAULT_STOCK_DATA } = require('../helpers/mockProvider');
const { createUserAndToken } = require('../helpers/authToken');
const Stock = require('../../models/Stock');
const WatchlistItem = require('../../models/WatchlistItem');

describe('/api/watchlist', () => {
  let token;
  let userId;

  before(connect);
  after(disconnect);

  beforeEach(async () => {
    await clearCollections();
    ({ token, user: { _id: userId } = {} } = await createUserAndToken());
    installStubs();
  });
  afterEach(restore);

  describe('POST /api/watchlist', () => {
    it('adds a ticker, grades it, and freezes the grade as gradeAtAdd', async () => {
      const res = await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'AAPL' });

      expect(res.status).to.equal(201);
      expect(res.body.ticker).to.equal('AAPL');
      expect(res.body.gradeAtAdd).to.match(/^[A-F]$/);

      // Confirm the Stock cache was populated as a side effect.
      const cached = await Stock.findOne({ ticker: 'AAPL' });
      expect(cached).to.exist;
      expect(cached.price).to.equal(DEFAULT_STOCK_DATA.price);
    });

    it('accepts a company name and stores the canonical ticker', async () => {
      restore();
      installStubs({
        resolved: { symbol: 'MSFT', name: 'Microsoft Corporation' },
        stockData: { ...DEFAULT_STOCK_DATA, longName: 'Microsoft Corporation' }
      });

      const res = await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'Microsoft' });

      expect(res.status).to.equal(201);
      expect(res.body.ticker).to.equal('MSFT');
    });

    it('rejects duplicate tickers with 409', async () => {
      await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'AAPL' });

      const res = await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'AAPL' });

      expect(res.status).to.equal(409);
      expect(res.body.message).to.match(/already/i);
    });

    it('returns 404 when nothing resolves', async () => {
      restore();
      installStubs({ resolvedNull: true });

      const res = await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'nonsense123' });

      expect(res.status).to.equal(404);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app).post('/api/watchlist').send({ ticker: 'AAPL' });
      expect(res.status).to.equal(401);
    });
  });

  describe('GET /api/watchlist', () => {
    it('returns rows enriched with name, current grade, and price', async () => {
      await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'AAPL' });

      const res = await request(app)
        .get('/api/watchlist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.have.lengthOf(1);
      const row = res.body[0];
      expect(row).to.include({ ticker: 'AAPL', name: 'Apple Inc.' });
      expect(row.currentGrade).to.match(/^[A-F]$/);
      expect(row.price).to.equal(DEFAULT_STOCK_DATA.price);
      expect(row.currency).to.equal('USD');
      expect(row.gradeAtAdd).to.equal(row.currentGrade);
    });

    it('returns an empty list for a brand-new user', async () => {
      const res = await request(app)
        .get('/api/watchlist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array').that.is.empty;
    });
  });

  describe('DELETE /api/watchlist/:ticker', () => {
    it('removes a ticker from the user\'s watchlist', async () => {
      await request(app)
        .post('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
        .send({ ticker: 'AAPL' });

      const res = await request(app)
        .delete('/api/watchlist/AAPL')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).to.equal(200);
      expect(res.body.ticker).to.equal('AAPL');

      const remaining = await WatchlistItem.find({});
      expect(remaining).to.be.empty;
    });

    it('returns 404 when the ticker is not in the watchlist', async () => {
      const res = await request(app)
        .delete('/api/watchlist/NOPE')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).to.equal(404);
    });
  });
});
