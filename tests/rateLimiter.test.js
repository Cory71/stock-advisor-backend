// Tests for the shared Finnhub rate limiter. A fake clock stands in for real
// time, so a "60 second" wait finishes instantly.

const { expect } = require('chai');
const { createRateLimiter } = require('../lib/rateLimiter');

// A clock that only moves when sleep() is called.
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => { time += ms; },
    elapsed: () => time,
  };
}

describe('createRateLimiter', () => {
  it('lets calls through immediately while under the limit', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, ...clock });

    await limiter.waitForSlot();
    await limiter.waitForSlot();
    await limiter.waitForSlot();

    expect(clock.elapsed()).to.equal(0);
  });

  it('makes the next call wait for the window, instead of failing', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, ...clock });

    await limiter.waitForSlot();
    await limiter.waitForSlot();
    await limiter.waitForSlot();   // third call: must wait for the first to age out

    expect(clock.elapsed()).to.equal(60_000);
  });

  it('hands out slots in the order they were asked for', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, ...clock });
    const order = [];

    await Promise.all(['first', 'second', 'third'].map((name) =>
      limiter.waitForSlot().then(() => order.push(name))
    ));

    expect(order).to.deep.equal(['first', 'second', 'third']);
  });

  // 30 stocks x 4 calls each is what a large watchlist refresh asks for.
  it('spreads a large burst across windows without dropping any', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 55, windowMs: 60_000, ...clock });

    await Promise.all(Array.from({ length: 120 }, () => limiter.waitForSlot()));

    // 120 calls at 55 a minute need three windows: 0s, 60s, 120s.
    expect(clock.elapsed()).to.equal(120_000);
  });
});
