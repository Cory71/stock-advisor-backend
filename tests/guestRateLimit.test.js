// Tests for middleware/guestRateLimit.js on a tiny app with a limit of 2, so
// the limit can be reached in a couple of requests.

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const { guestRateLimit } = require('../middleware/guestRateLimit');

// A test app where the "x-test-user" header stands in for a logged-in user
// (in the real route, optionalAuth sets req.user from the JWT).
function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    if (req.get('x-test-user')) req.user = { id: 'user-1' };
    next();
  });
  app.get('/grade', guestRateLimit({ windowMs: 60_000, limit: 2 }), (req, res) => res.json({ ok: true }));
  return app;
}

describe('guestRateLimit', () => {
  it('lets a guest through up to the limit, then answers 429 with a message', async () => {
    const app = buildApp();
    await request(app).get('/grade').expect(200);
    await request(app).get('/grade').expect(200);

    const res = await request(app).get('/grade');

    expect(res.status).to.equal(429);
    expect(res.body.message).to.match(/too many lookups/i);
  });

  // Signed-in users have an account tied to what they do, so they aren't capped.
  it('never limits a signed-in user', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      await request(app).get('/grade').set('x-test-user', 'yes').expect(200);
    }
  });
});
