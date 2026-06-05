// API tests for /api/auth — register, login, /me.
// Run with: npm test

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../server');
const { connect, disconnect, clearCollections } = require('../helpers/testDb');

describe('POST /api/auth/register', () => {
  before(connect);
  after(disconnect);
  afterEach(clearCollections);

  it('creates a user and returns a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'password1', displayName: 'New User' });

    expect(res.status).to.equal(201);
    expect(res.body).to.have.property('token').that.is.a('string');
    expect(res.body.user).to.include({ email: 'new@example.com', displayName: 'New User' });
    expect(res.body.user).to.not.have.property('passwordHash');
  });

  it('rejects a missing password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nopass@example.com' });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/required/i);
  });

  it('rejects a password shorter than 6 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: 'abc' });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/6 characters/i);
  });

  it('rejects duplicate emails', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password1' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password2' });

    expect(res.status).to.equal(409);
    expect(res.body.message).to.match(/already exists/i);
  });
});

describe('POST /api/auth/login', () => {
  before(connect);
  after(disconnect);
  afterEach(clearCollections);

  it('returns a JWT for valid credentials', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'password1' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'password1' });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('token').that.is.a('string');
    expect(res.body.user.email).to.equal('login@example.com');
  });

  it('rejects a wrong password with 401 and a generic message', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'wrongpw@example.com', password: 'password1' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'differentpw' });

    expect(res.status).to.equal(401);
    expect(res.body.message).to.match(/invalid/i);
  });

  it('returns the same 401 message for an unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(res.status).to.equal(401);
    expect(res.body.message).to.match(/invalid/i);
  });
});

describe('GET /api/auth/me', () => {
  before(connect);
  after(disconnect);
  afterEach(clearCollections);

  it('returns the current user when given a valid JWT', async () => {
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: 'me@example.com', password: 'password1', displayName: 'Me' });
    const token = register.body.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.user).to.include({ email: 'me@example.com', displayName: 'Me' });
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).to.equal(401);
  });

  it('rejects requests with a bad token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).to.equal(401);
  });
});
