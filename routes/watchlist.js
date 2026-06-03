// Watchlist routes — the user's saved tickers.
// All routes here require a valid JWT in the Authorization header.

const express = require('express');
const WatchlistItem = require('../models/WatchlistItem');
const Stock = require('../models/Stock');
const verifyToken = require('../middleware/authMiddleware');
const { gradeStock } = require('../lib/grading');
const { getStockData, resolveTicker } = require('../providers/yahooProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;             // 24 hours — same as grade.js
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;     // e.g. AAPL, BRK.A, SHOP.TO

// Every route in this file is protected — apply the middleware once.
router.use(verifyToken);

// Look up (or grade) a ticker and return the cached Stock document.
// Used by POST to capture `gradeAtAdd` at the moment the user clicks Add.
async function ensureStock(ticker) {
  // Cache hit + fresh — nothing to do. Missing price counts as stale so older
  // pre-price-field docs get backfilled on the next add.
  const cached = await Stock.findOne({ ticker });
  if (cached && cached.price != null && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  // Cache miss or stale — fetch + grade now so we can freeze the letter.
  const rawData = await getStockData(ticker);
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

    const raw = ticker.trim();
    let canonical = raw.toUpperCase();

    // If the input doesn't look like a ticker symbol (e.g. "Apple", "Microsoft"),
    // resolve it to a canonical ticker via Yahoo search — same flow as /api/grade.
    if (!TICKER_PATTERN.test(canonical)) {
      const resolved = await resolveTicker(raw).catch(() => null);
      if (!resolved) {
        return res
          .status(404)
          .json({ message: `Couldn't find a stock for "${raw}".` });
      }
      canonical = resolved.symbol;
    }

    // Grade the stock so we can store the grade-at-add snapshot.
    // If this fails (e.g. ticker pattern looked valid but Yahoo doesn't know it),
    // we don't create the watchlist row.
    let stock;
    try {
      stock = await ensureStock(canonical);
    } catch (err) {
      return res.status(400).json({
        message: `Couldn't grade "${canonical}". Check the ticker and try again.`
      });
    }

    const item = await WatchlistItem.create({
      userId: req.user.id,
      ticker: canonical,
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
