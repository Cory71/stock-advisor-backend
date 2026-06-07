// GET /api/compare?tickers=AAPL,MSFT,GOOG
// Each "ticker" in the list may also be a company name — they're resolved to
// canonical symbols the same way the /api/grade endpoint does it.

const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const Stock = require('../models/Stock');
const SearchHistory = require('../models/SearchHistory');
const { gradeStock } = require('../lib/grading');
const finnhubProvider = require('../providers/finnhubProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;

// Grade a single query (ticker or name). Same flow as routes/grade.js but
// returns a result object instead of writing to res.
async function gradeOne(query, userId) {
  const raw = query.trim();
  let ticker = raw.toUpperCase();
  let resolvedName = null;

  // Resolve names to canonical ticker.
  if (!TICKER_PATTERN.test(ticker)) {
    const resolved = await finnhubProvider.resolveTicker(raw);
    if (!resolved) {
      throw new Error(`Couldn't find a stock for "${raw}".`);
    }
    ticker = resolved.symbol;
    resolvedName = resolved.name;
  }

  // Cache lookup. Missing price = treat as stale so we backfill on next grade.
  const cached = await Stock.findOne({ ticker });
  if (cached && cached.price != null && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    // Fire-and-forget history record (with dedup).
    SearchHistory.findOne({ userId }).sort({ createdAt: -1 }).select('ticker').then((last) => {
      if (!last || last.ticker !== ticker) {
        SearchHistory.create({ userId, ticker }).catch(() => {});
      }
    });
    return {
      ticker: cached.ticker,
      name: cached.name || null,
      price: cached.price ?? null,
      currency: cached.currency || null,
      grade: cached.grade,
      criteria: cached.criteria,
      gradedAt: cached.updatedAt,
      cached: true
    };
  }

  // Cache miss — fetch + grade.
  let rawData;
  try {
    rawData = await finnhubProvider.getStockData(ticker);
  } catch (err) {
    const fallback = await finnhubProvider.resolveTicker(raw);
    if (!fallback) throw new Error(`Couldn't find a stock for "${raw}".`);
    ticker = fallback.symbol;
    resolvedName = fallback.name;
    rawData = await finnhubProvider.getStockData(ticker);
  }

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
      rawData
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Record history (with dedup).
  const lastSearch = await SearchHistory.findOne({ userId }).sort({ createdAt: -1 }).select('ticker');
  if (!lastSearch || lastSearch.ticker !== ticker) {
    SearchHistory.create({ userId, ticker }).catch(() => {});
  }

  return {
    ticker: saved.ticker,
    name: saved.name,
    price: saved.price ?? null,
    currency: saved.currency || null,
    grade: saved.grade,
    criteria: saved.criteria,
    gradedAt: saved.updatedAt,
    cached: false
  };
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const raw = req.query.tickers || '';
    const queries = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (queries.length < 2 || queries.length > 3) {
      return res
        .status(400)
        .json({ message: 'Provide 2 or 3 tickers (or company names) as a comma-separated `tickers` query parameter.' });
    }

    // Grade everything in parallel — one bad query doesn't ruin the others.
    const settled = await Promise.allSettled(queries.map((q) => gradeOne(q, req.user.id)));
    const results = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { ticker: queries[i].toUpperCase(), error: r.reason.message };
    });

    res.json(results);
  } catch (err) {
    // Note: per-ticker failures are already returned inline above, so this
    // outer catch only fires for truly broken requests (malformed params, etc.).
    res.status(503).json({
      message: 'Stock data is temporarily unavailable. Please try again in a moment.',
      error: err.message
    });
  }
});

module.exports = router;
