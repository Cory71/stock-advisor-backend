// GET /api/grade/:query
// `query` can be either a ticker symbol (e.g. "AAPL") or a company name
// (e.g. "Apple"). The route resolves names to canonical tickers via Finnhub's
// search endpoint and caches the result in MongoDB for 24 hours.
//
// Public: anyone can grade a stock without logging in, so a first-time visitor
// sees the app working straight away. Logging in adds the extras — the search
// is saved to history, and ?refresh=1 can force a fresh re-grade. Guests are
// rate limited (middleware/guestRateLimit.js).

const express = require('express');
const optionalAuth = require('../middleware/optionalAuth');
const { guestRateLimit } = require('../middleware/guestRateLimit');
const Stock = require('../models/Stock');
const SearchHistory = require('../models/SearchHistory');
const { gradeAndSave } = require('../lib/gradeAndSave');
const { friendlyStockError } = require('../lib/friendlyError');
const { sectorContextFor } = require('../lib/sectorBaselines');
// Imported as a namespace (not destructured) so test stubs that swap out
// `finnhubProvider.getStockData` are actually seen by these route handlers.
const finnhubProvider = require('../providers/finnhubProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;                  // 24 hours
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;           // e.g. AAPL, BRK.A

// Record a lookup in the user's history — but skip if their last search was
// for the same ticker, so a Refresh / re-navigation doesn't fill the list with
// duplicates. Fire-and-forget; we don't want history writes blocking the response.
// Guests (no user) have no history, so nothing is saved for them.
async function recordHistory(user, ticker) {
  if (!user) return;
  const userId = user.id;
  const lastSearch = await SearchHistory.findOne({ userId })
    .sort({ createdAt: -1 })
    .select('ticker');
  if (!lastSearch || lastSearch.ticker !== ticker) {
    SearchHistory.create({ userId, ticker }).catch(() => {});
  }
}

// Shape a cached or fresh Stock document into the JSON the frontend expects.
// `fallbackName` covers older cached docs that pre-date the `name` field.
function shape(stock, { cached, fallbackName }) {
  return {
    ticker: stock.ticker,
    name: stock.name || fallbackName || null,
    price: stock.price ?? null,
    currency: stock.currency || null,
    // Which model graded it — the page labels bank grades, since the same
    // letter means something different under each model.
    model: stock.model || 'general',
    grade: stock.grade,
    criteria: stock.criteria,
    reason: stock.reason || null,
    note: stock.note || null,
    rawData: stock.rawData,
    gradedAt: stock.updatedAt,
    cached
  };
}

// The shaped result plus how the stock compares with its industry (null when
// there aren't enough peers). A failed lookup just leaves the comparison out —
// it must never stop a grade from showing.
async function shapeWithContext(stock, options) {
  const sectorContext = await sectorContextFor(stock).catch(() => null);
  return { ...shape(stock, options), sectorContext };
}

router.get('/:query', optionalAuth, guestRateLimit(), async (req, res) => {
  try {
    const raw = req.params.query.trim();
    let ticker = raw.toUpperCase();
    let resolvedName = null;

    // If the input doesn't look like a ticker symbol (e.g. "Apple", "Microsoft"),
    // resolve it to a canonical ticker via Finnhub search before doing anything else.
    if (!TICKER_PATTERN.test(ticker)) {
      const resolved = await finnhubProvider.resolveTicker(raw);
      if (!resolved) {
        return res
          .status(404)
          .json({ message: `Couldn't find a stock for "${raw}".` });
      }
      ticker = resolved.symbol;
      resolvedName = resolved.name;
    }

    // `?refresh=1` lets the user force a fresh re-grade from the grade page,
    // skipping the cache so the data and timestamp update on demand.
    // Signed-in users only — a guest always gets the cached grade when there is
    // one, so the public route can't be used to burn through Finnhub calls.
    const forceRefresh = Boolean(req.user)
      && (req.query.refresh === '1' || req.query.refresh === 'true');

    // Try the cache first — same canonical ticker, same grade.
    // Cache is considered stale if it's older than the TTL, OR if it's missing
    // a price (older records from before the price field existed). Forcing a
    // re-grade is the simplest way to backfill price on legacy docs.
    const cached = await Stock.findOne({ ticker });
    const isFresh = !forceRefresh
      && cached
      && cached.price != null
      && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS;

    if (isFresh) {
      // Self-heal: if the cached entry is missing `name` (older record from
      // before this field existed), fetch and store it now so the next lookup
      // is clean. One-time cost per stale ticker.
      if (!cached.name && !resolvedName) {
        const resolved = await finnhubProvider.resolveTicker(ticker).catch(() => null);
        if (resolved?.name) {
          cached.name = resolved.name;
          await cached.save().catch(() => {});
        }
      }

      await recordHistory(req.user, ticker);
      return res.json(await shapeWithContext(cached, { cached: true, fallbackName: resolvedName }));
    }

    // Cache miss or stale — fetch fresh data from Finnhub.
    let rawData;
    try {
      rawData = await finnhubProvider.getStockData(ticker);
    } catch (err) {
      // 403 = the provider doesn't cover this symbol (e.g. a Toronto ".TO"
      // listing). Searching won't help, so tell the user plainly instead of
      // falling through to a "temporarily unavailable" message.
      if (err.status === 403) {
        return res.status(404).json({ message: friendlyStockError(err, ticker) });
      }
      // The input looked like a ticker but Finnhub doesn't recognise it. Last
      // resort: try a search before giving up.
      const fallback = await finnhubProvider.resolveTicker(raw);
      if (!fallback) {
        return res
          .status(404)
          .json({ message: `Couldn't find a stock for "${raw}".` });
      }
      ticker = fallback.symbol;
      resolvedName = fallback.name;
      // Re-check cache with the resolved ticker before fetching again
      // (unless the user asked for a forced refresh).
      const cachedAfter = await Stock.findOne({ ticker });
      if (!forceRefresh && cachedAfter && cachedAfter.price != null && Date.now() - cachedAfter.updatedAt.getTime() < CACHE_TTL_MS) {
        await recordHistory(req.user, ticker);
        return res.json(await shapeWithContext(cachedAfter, { cached: true, fallbackName: resolvedName }));
      }
      rawData = await finnhubProvider.getStockData(ticker);
    }

    // Prefer the name from getStockData (more reliable); fall back to whatever
    // search returned earlier.
    const saved = await gradeAndSave(ticker, rawData, { fallbackName: resolvedName });

    await recordHistory(req.user, ticker);
    res.json(await shapeWithContext(saved, { cached: false, fallbackName: resolvedName }));
  } catch (err) {
    // This path fires when Finnhub is unreachable or returns an unexpected error.
    // 404s for unknown tickers are handled above. The raw error is included for
    // server-side debugging.
    res.status(503).json({
      message: 'Stock data is temporarily unavailable. Please try again in a moment.',
      error: err.message
    });
  }
});

module.exports = router;
