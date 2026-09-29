// Watchlist routes — the user's saved tickers.
// All routes here require a valid JWT in the Authorization header.

const express = require('express');
const WatchlistItem = require('../models/WatchlistItem');
const Stock = require('../models/Stock');
const verifyToken = require('../middleware/authMiddleware');
const { gradeAndSave } = require('../lib/gradeAndSave');
const { friendlyStockError } = require('../lib/friendlyError');
const finnhubProvider = require('../providers/finnhubProvider');

const router = express.Router();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;             // 24 hours — same as grade.js
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]+)?$/;     // e.g. AAPL, BRK.A, SHOP.TO

// Every route in this file is protected — apply the middleware once.
router.use(verifyToken);

// Resolve a user query (ticker or company name) into a fresh-or-cached Stock
// doc. Same flow as routes/grade.js — including the fallback for inputs that
// match TICKER_PATTERN but aren't real tickers (e.g. "APPLE" → AAPL, "TESLA"
// → TSLA). Throws an Error when nothing matches; caller turns that into a 404.
async function resolveAndGrade(raw, { forceRefresh = false } = {}) {
  let ticker = raw.toUpperCase();

  // Step 1 — long inputs are obviously names; resolve them up front.
  if (!TICKER_PATTERN.test(ticker)) {
    const resolved = await finnhubProvider.resolveTicker(raw);
    if (!resolved) throw new Error(`Couldn't find a stock for "${raw}".`);
    ticker = resolved.symbol;
  }

  // Step 2 — cache check. Missing price counts as stale so older pre-price
  // docs get backfilled on the next add. A forced refresh skips the cache.
  const cached = await Stock.findOne({ ticker });
  if (!forceRefresh && cached && cached.price != null && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  // Step 3 — fresh grade. If Finnhub doesn't recognise the symbol (because the
  // input only LOOKED like a ticker — e.g. APPLE), fall back to a search.
  let rawData;
  try {
    rawData = await finnhubProvider.getStockData(ticker);
  } catch (err) {
    // 403 = symbol the provider doesn't cover (e.g. a ".TO" listing); re-throw
    // so the caller can show the friendly "U.S.-listed only" message.
    if (err.status === 403) throw err;
    const fallback = await finnhubProvider.resolveTicker(raw);
    if (!fallback) throw new Error(`Couldn't find a stock for "${raw}".`);
    ticker = fallback.symbol;
    // Re-check cache against the newly resolved ticker before re-fetching
    // (unless we're forcing a refresh).
    const cachedAfter = await Stock.findOne({ ticker });
    if (!forceRefresh && cachedAfter && cachedAfter.price != null && Date.now() - cachedAfter.updatedAt.getTime() < CACHE_TTL_MS) {
      return cachedAfter;
    }
    rawData = await finnhubProvider.getStockData(ticker);
  }

  return gradeAndSave(ticker, rawData);
}

// Load a user's saved tickers (newest first) and enrich each row with the live
// grade + company name from the Stock cache, so the page can show
// upgrades/downgrades since the user added the ticker. Shared by the list and
// refresh routes.
async function enrichWatchlist(userId) {
  const items = await WatchlistItem
    .find({ userId })
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

  return items.map((item) => {
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
}

// GET /api/watchlist
// Returns the current user's saved tickers, newest first.
router.get('/', async (req, res) => {
  try {
    res.json(await enrichWatchlist(req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ---------- Refreshing ----------

// Anything graded within the last hour is left alone, so a double click — or a
// click just after the daily refresh — costs no Finnhub calls at all.
const RECENT_REFRESH_MS = 60 * 60 * 1000;   // 1 hour

// True when the cached stock was graded within the last hour.
async function gradedRecently(ticker) {
  const cached = await Stock.findOne({ ticker }).select('updatedAt price').lean();
  if (!cached || cached.price == null) return false;
  return Date.now() - new Date(cached.updatedAt).getTime() < RECENT_REFRESH_MS;
}

// Re-grade one ticker unless it was graded recently. Returns true when it
// actually fetched fresh data. Finnhub calls are paced by the provider's
// shared rate limiter, so a long list waits its turn rather than failing.
async function refreshIfOld(ticker) {
  if (await gradedRecently(ticker)) return false;
  await resolveAndGrade(ticker, { forceRefresh: true });
  return true;
}

// POST /api/watchlist/refresh
// Re-grades every ticker in the watchlist that wasn't graded in the last hour,
// then returns the updated list. A single failing ticker is skipped so the rest
// of the list still refreshes.
router.post('/refresh', async (req, res) => {
  try {
    const items = await WatchlistItem
      .find({ userId: req.user.id })
      .select('ticker')
      .lean();

    for (const item of items) {
      try {
        await refreshIfOld(item.ticker);
      } catch {
        // Skip tickers that can't be re-graded right now (e.g. a delisted
        // symbol or a transient provider error) — the rest still refresh.
      }
    }

    res.json(await enrichWatchlist(req.user.id));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/watchlist/:ticker/refresh
// Re-grades a single watchlist row. The page calls this once per row so it can
// show "Refreshing 12 of 30…" as it goes, then reloads the list at the end.
// Returns { ticker, refreshed } — refreshed is false when the row was graded in
// the last hour and was skipped.
router.post('/:ticker/refresh', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    // Only rows in this user's own watchlist can be refreshed through here.
    const onWatchlist = await WatchlistItem.exists({ userId: req.user.id, ticker });
    if (!onWatchlist) {
      return res.status(404).json({ message: `${ticker} isn't on your watchlist.` });
    }

    const refreshed = await refreshIfOld(ticker);
    res.json({ ticker, refreshed });
  } catch (err) {
    res.status(502).json({ message: friendlyStockError(err, ticker) });
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
      return res.status(404).json({ message: friendlyStockError(err, ticker.trim()) });
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
