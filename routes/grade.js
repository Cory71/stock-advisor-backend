// GET /api/grade/:query
// `query` can be either a ticker symbol (e.g. "AAPL") or a company name
// (e.g. "Apple"). The route resolves names to canonical tickers via Finnhub's
// search endpoint and caches the result in MongoDB for 24 hours.

const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const Stock = require('../models/Stock');
const SearchHistory = require('../models/SearchHistory');
const { gradeStock } = require('../lib/grading');
// Imported as a namespace (not destructured) so test stubs that swap out
// `finnhubProvider.getStockData` are actually seen by these route handlers.
const finnhubProvider = require('../providers/finnhubProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;                  // 24 hours
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;           // e.g. AAPL, BRK.A

// Record a lookup in the user's history — but skip if their last search was
// for the same ticker, so a Refresh / re-navigation doesn't fill the list with
// duplicates. Fire-and-forget; we don't want history writes blocking the response.
async function recordHistory(userId, ticker) {
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
    grade: stock.grade,
    criteria: stock.criteria,
    reason: stock.reason || null,
    note: stock.note || null,
    rawData: stock.rawData,
    gradedAt: stock.updatedAt,
    cached
  };
}

router.get('/:query', verifyToken, async (req, res) => {
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

    // Try the cache first — same canonical ticker, same grade.
    // Cache is considered stale if it's older than the TTL, OR if it's missing
    // a price (older records from before the price field existed). Forcing a
    // re-grade is the simplest way to backfill price on legacy docs.
    const cached = await Stock.findOne({ ticker });
    const isFresh = cached
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

      await recordHistory(req.user.id, ticker);
      return res.json(shape(cached, { cached: true, fallbackName: resolvedName }));
    }

    // Cache miss or stale — fetch fresh data from Finnhub.
    let rawData;
    try {
      rawData = await finnhubProvider.getStockData(ticker);
    } catch (err) {
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
      // Re-check cache with the resolved ticker before fetching again.
      const cachedAfter = await Stock.findOne({ ticker });
      if (cachedAfter && cachedAfter.price != null && Date.now() - cachedAfter.updatedAt.getTime() < CACHE_TTL_MS) {
        await recordHistory(req.user.id, ticker);
        return res.json(shape(cachedAfter, { cached: true, fallbackName: resolvedName }));
      }
      rawData = await finnhubProvider.getStockData(ticker);
    }

    // Prefer the name from getStockData (more reliable); fall back to whatever
    // search returned earlier.
    const name = rawData.longName || resolvedName;

    const graded = gradeStock(rawData);

    const saved = await Stock.findOneAndUpdate(
      { ticker },
      {
        ticker,
        name,
        price: rawData.price ?? null,
        currency: rawData.currency ?? null,
        grade: graded.grade,
        criteria: graded.criteria,
        reason: graded.reason ?? null,
        note: graded.note ?? null,
        rawData
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recordHistory(req.user.id, ticker);
    res.json(shape(saved, { cached: false, fallbackName: resolvedName }));
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
