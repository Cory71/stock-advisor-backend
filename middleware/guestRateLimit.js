// Rate limit for visitors who aren't logged in.
//
// The grade route is public so anyone can try the app, but each uncached
// grade costs 4 Finnhub calls out of a shared 60 a minute. This caps how many
// lookups one connection can make as a guest. Signed-in users are skipped:
// they already have an account tied to what they do.
//
// Must run after optionalAuth, which is what sets req.user.

const { rateLimit } = require('express-rate-limit');

const GUEST_WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
const GUEST_LIMIT = 30;                   // lookups per window, per IP address

// Built by a function so tests can use a tiny limit instead of 30.
function guestRateLimit({ windowMs = GUEST_WINDOW_MS, limit = GUEST_LIMIT } = {}) {
  return rateLimit({
    windowMs,
    limit,
    skip: (req) => Boolean(req.user),
    standardHeaders: 'draft-8',   // tells the client how long to wait
    legacyHeaders: false,
    // Same { message } shape as every other error, so the page shows it as is.
    message: {
      message: 'Too many lookups from this connection. Please wait a few minutes, or log in to keep grading.',
    },
  });
}

module.exports = { guestRateLimit, GUEST_LIMIT, GUEST_WINDOW_MS };
