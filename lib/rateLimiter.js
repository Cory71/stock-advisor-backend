// A small "take a number" rate limiter. Callers await waitForSlot() before
// making a request; if the limit for the current window is used up, they wait
// until the oldest request ages out instead of failing.
//
// Requests are handed out strictly in the order they asked, so a big
// "Refresh all" can't jump ahead of someone opening a single grade page.

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `now` and `sleep` can be swapped out in tests so they don't need to wait.
function createRateLimiter({ limit, windowMs, now = Date.now, sleep = defaultSleep }) {
  const recentCalls = [];          // timestamps of calls inside the window, oldest first
  let queue = Promise.resolve();   // chain that keeps callers in arrival order

  // Forget calls that have fallen out of the window.
  function dropExpired(currentTime) {
    while (recentCalls.length > 0 && currentTime - recentCalls[0] >= windowMs) {
      recentCalls.shift();
    }
  }

  // Wait (if needed) until a slot is free, then claim it.
  async function claimSlot() {
    dropExpired(now());
    while (recentCalls.length >= limit) {
      const waitMs = windowMs - (now() - recentCalls[0]);
      await sleep(Math.max(waitMs, 0));
      dropExpired(now());
    }
    recentCalls.push(now());
  }

  function waitForSlot() {
    const turn = queue.then(claimSlot);
    // Keep the chain alive even if a caller's slot claim somehow fails.
    queue = turn.catch(() => {});
    return turn;
  }

  return { waitForSlot };
}

module.exports = { createRateLimiter };
