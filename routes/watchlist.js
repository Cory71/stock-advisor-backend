// Watchlist routes — the user's saved tickers.
// All routes here require a valid JWT in the Authorization header.

const express = require('express');
const WatchlistItem = require('../models/WatchlistItem');
const Stock = require('../models/Stock');
const verifyToken = require('../middleware/authMiddleware');
const { gradeStock } = require('../lib/grading');
const yahooProvider = require('../providers/yahooProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;             // 24 hours — same as grade.js
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;     // e.g. AAPL, BRK.A, SHOP.TO

// Every route in this file is protected — apply the middleware once.
router.use(verifyToken);

// Resolve a user query (ticker or company name) into a fresh-or-cached Stock
// doc. Same flow as routes/grade.js — including the fallback for inputs that
// match TICKER_PATTERN but aren't real tickers (e.g. "APPLE" → AAPL, "TESLA"
// → TSLA). Throws an Error when nothing matches; caller turns that into a 404.
async function resolveAndGrade(raw) {
  let ticker = raw.toUpperCase();

  // Step 1 — long inputs are obviously names; resolve them up front.
  if (!TICKER_PATTERN.test(ticker)) {
    const resolved = await yahooProvider.resolveTicker(raw);
    if (!resolved) throw new Error(`Couldn't find a stock for "${raw}".`);
    ticker = resolved.symbol;
  }

  // Step 2 — cache check. Missing price counts as stale so older pre-price
  // docs get backfilled on the next add.
  const cached = await Stock.findOne({ ticker });
  if (cached && cached.price != null && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  // Step 3 — fresh grade. If Yahoo doesn't recognise the symbol (because the
  // input only LOOKED like a ticker — e.g. APPLE), fall back to a search.
  let rawData;
  try {
    rawData = await yahooProvider.getStockData(ticker);
  } catch (err) {
    const fallback = await yahooProvider.resolveTicker(raw);
    if (!fallback) throw new Error(`Couldn't find a stock for "${raw}".`);
    ticker = fallback.symbol;
    // Re-check cache against the newly resolved ticker before re-fetching.
    const cachedAfter = await Stock.findOne({ ticker });
    if (cachedAfter && cachedAfter.price != null && Date.now() - cachedAfter.updatedAt.getTime() < CACHE_TTL_MS) {
      return cachedAfter;
    }
    rawData = await yahooProvider.getStockData(ticker);
  }

  const graded = gradeStock(rawData);
  const name = rawData.longName || null;

  return Stock.findOneAndUpdate(
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
}

// GET /api/watchlist
// Returns the current user's saved tickers, newest first. Each row is enriched
// with the live grade + company name from the Stock cache so the page can show
// upgrades/downgrades since the user added the ticker.
router.get('/', async (req, res) => {
  try {
    const items = await WatchlistItem
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    // One DB query pulls every cached stock the user is watching.
    const tickers = items.map((item) => item.ticker);
    const stocks = await Stock
      .find({ ticker: { $in: tickers } })
      .select('ticker name grade price currency updatedAt')
      .lean();

    // Build a quick lookup so we can attach data per row.
    const stockByTicker = {};
    for (const stock of stocks) {
      stockByTicker[stock.ticker] = stock;
    }

    const enriched = items.map((item) => {
      const stock = stockByTicker[item.ticker];
      return {
        ...item,
        name: stock?.name || null,
        currentGrade: stock?.grade || null,
        price: stock?.price ?? null,
        currency: stock?.currency || null,
        gradedAt: stock?.updatedAt || null
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/watchlist
// Body: { ticker }  (also accepts a company name — same as /api/grade)
// Adds a ticker to the current user's watchlist and freezes the current grade
// as `gradeAtAdd` so the UI can later show whether it moved up or down.
router.post('/', async (req, res) => {
  try {
    const { ticker } = req.body;

    if (!ticker) {
      return res.status(400).json({ message: 'Ticker is required' });
    }

    let stock;
    try {
      stock = await resolveAndGrade(ticker.trim());
    } catch (err) {
      return res.status(404).json({ message: err.message });
    }

    // Use the canonical ticker from the resolved stock — not whatever the user
    // typed — so the watchlist row links to /grade/AAPL even if they typed "Apple".
    const item = await WatchlistItem.create({
      userId: req.user.id,
      ticker: stock.ticker,
      gradeAtAdd: stock.grade
    });

    res.status(201).json(item);
  } catch (err) {
    // The compound unique index on (userId, ticker) throws this code
    // when the user tries to add the same ticker twice.
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: 'Ticker is already in your watchlist' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE /api/watchlist/:ticker
// Removes a ticker from the current user's watchlist.
router.delete('/:ticker', async (req, res) => {
  try {
    // Normalise — tickers are stored uppercase.
    const ticker = req.params.ticker.toUpperCase();

    const deleted = await WatchlistItem.findOneAndDelete({
      userId: req.user.id,
      ticker
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: 'Ticker not found in your watchlist' });
    }

    res.json({ message: 'Removed', ticker });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
