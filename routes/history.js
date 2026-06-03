// History route — returns the current user's last 20 grade lookups.
// Records get written by the /api/grade route on every successful lookup.

const express = require('express');
const SearchHistory = require('../models/SearchHistory');
const Stock = require('../models/Stock');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

// All routes here are protected — only the logged-in user can read their own history.
router.use(verifyToken);

// GET /api/history
// Returns the current user's last 20 ticker lookups, newest first. Each row
// is enriched with the company name from the Stock cache so the UI can show
// "AAPL · Apple Inc." next to the date.
router.get('/', async (req, res) => {
  try {
    const rows = await SearchHistory
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // One query pulls the cached name for every ticker in the history list.
    const tickers = rows.map((row) => row.ticker);
    const stocks = await Stock
      .find({ ticker: { $in: tickers } })
      .select('ticker name')
      .lean();

    const nameByTicker = {};
    for (const stock of stocks) {
      nameByTicker[stock.ticker] = stock.name || null;
    }

    const enriched = rows.map((row) => ({
      ...row,
      name: nameByTicker[row.ticker] || null
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
