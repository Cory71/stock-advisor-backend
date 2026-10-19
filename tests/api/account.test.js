// API tests for the account settings routes: change display name, export data,
// clear search history, and delete the account.

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');
const { createUserAndToken } = require('../helpers/authToken');
const User = require('../../models/User');
const Stock = require('../../models/Stock');
const WatchlistItem = require('../../models/WatchlistItem');
const SearchHistory = require('../../models/SearchHistory');

describe('account settings', () => {
  let token;
  let user;

  before(connect);
  after(disconnect);

  beforeEach(async () => {
    await clearCollections();
    ({ token, user } = await createUserAndToken({ email: 'cory@example.com', displayName: 'Cory' }));
  });

  // Give the user a watchlist row and two history rows, and put a shared stock
  // grade in the cache that belongs to nobody in particular.
  async function addUserData() {
    await WatchlistItem.create({ userId: user._id, ticker: 'AAPL', gradeAtAdd: 'A' });
    await SearchHistory.create({ userId: user._id, ticker: 'AAPL' });
    await SearchHistory.create({ userId: user._id, ticker: 'JPM' });
    // Graded B today, though it was an A when added — so the export can show the change.
    await Stock.create({ ticker: 'AAPL', grade: 'B', criteria: [], rawData: {} });
  }

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  describe('PATCH /api/auth/me — display name', () => {
    it('changes the display name and returns the updated user', async () => {
      const res = await auth(request(app).patch('/api/auth/me')).send({ displayName: '  Cory C  ' });
      expect(res.status).to.equal(200);
      expect(res.body.user.displayName).to.equal('Cory C');
    });

    // An empty name clears it, so the navbar falls back to the email.
    it('clears the display name when given an empty one', async () => {
      const res = await auth(request(app).patch('/api/auth/me')).send({ displayName: '   ' });
      expect(res.status).to.equal(200);
      expect(res.body.user.displayName).to.equal(null);
    });

    it('rejects a name longer than 50 characters', async () => {
      const res = await auth(request(app).patch('/api/auth/me')).send({ displayName: 'x'.repeat(51) });
      expect(res.status).to.equal(400);
    });

    it('requires a login', async () => {
      const res = await request(app).patch('/api/auth/me').send({ displayName: 'Nope' });
      expect(res.status).to.equal(401);
    });
  });

  describe('GET /api/auth/me/export', () => {
    it('returns the account, watchlist and search history', async () => {
      await addUserData();
      const res = await auth(request(app).get('/api/auth/me/export'));

      expect(res.status).to.equal(200);
      expect(res.body.account).to.include({ email: 'cory@example.com', displayName: 'Cory' });
      expect(res.body.watchlist).to.have.lengthOf(1);
      expect(res.body.watchlist[0]).to.include({ ticker: 'AAPL', gradeWhenAdded: 'A', currentGrade: 'B' });
      expect(res.body.searchHistory.map((r) => r.ticker)).to.have.members(['AAPL', 'JPM']);
    });

    it('never includes the password hash', async () => {
      const res = await auth(request(app).get('/api/auth/me/export'));
      const text = JSON.stringify(res.body);
      expect(text).to.not.include('passwordHash');
      expect(text).to.not.include('not-used-in-tests');
      expect(res.body.account.signInMethods).to.deep.equal({ password: true, google: false });
    });
  });

  describe('DELETE /api/history — clear search history', () => {
    it('removes the history but keeps the account and watchlist', async () => {
      await addUserData();
      const res = await auth(request(app).delete('/api/history'));

      expect(res.status).to.equal(200);
      expect(res.body.deleted).to.equal(2);
      expect(await SearchHistory.countDocuments({ userId: user._id })).to.equal(0);
      expect(await WatchlistItem.countDocuments({ userId: user._id })).to.equal(1);
      expect(await User.countDocuments({ _id: user._id })).to.equal(1);
    });
  });

  describe('DELETE /api/auth/me — delete account', () => {
    it('refuses without the right confirmation email', async () => {
      const res = await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: 'someone@else.com' });
      expect(res.status).to.equal(400);
      expect(await User.countDocuments({ _id: user._id })).to.equal(1);
    });

    it('accepts the email in any case, with spaces around it', async () => {
      const res = await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: '  Cory@Example.com ' });
      expect(res.status).to.equal(204);
    });

    it('removes the user, their watchlist and their history', async () => {
      await addUserData();
      await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: 'cory@example.com' });

      expect(await User.countDocuments({ _id: user._id })).to.equal(0);
      expect(await WatchlistItem.countDocuments({ userId: user._id })).to.equal(0);
      expect(await SearchHistory.countDocuments({ userId: user._id })).to.equal(0);
    });

    // The Stock cache is shared by every user — deleting it would remove other
    // people's data.
    it('leaves the shared stock cache alone', async () => {
      await addUserData();
      await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: 'cory@example.com' });
      expect(await Stock.countDocuments({ ticker: 'AAPL' })).to.equal(1);
    });

    it("doesn't touch another user's data", async () => {
      const other = await createUserAndToken({ email: 'other@example.com' });
      await WatchlistItem.create({ userId: other.user._id, ticker: 'MSFT', gradeAtAdd: 'B' });

      await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: 'cory@example.com' });

      expect(await User.countDocuments({ _id: other.user._id })).to.equal(1);
      expect(await WatchlistItem.countDocuments({ userId: other.user._id })).to.equal(1);
    });

    // Every protected request looks the user up again, so the old token is
    // useless the moment the account is gone.
    it('makes the old login token stop working', async () => {
      await auth(request(app).delete('/api/auth/me')).send({ confirmEmail: 'cory@example.com' });
      const res = await auth(request(app).get('/api/auth/me'));
      expect(res.status).to.equal(401);
    });
  });
});
